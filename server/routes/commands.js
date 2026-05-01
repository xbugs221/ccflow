/**
 * Serve built-in quick-alias markdown commands plus user commands from ~/.config/ccflow-alias.
 */
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const router = express.Router();
const ALIAS_DIRECTORY_NAME = path.join('.config', 'ccflow-alias');
const ALIAS_NAMESPACE = 'alias';
const BUILTIN_ALIAS_NAMESPACE = 'builtin';
const aliasBaseDir = path.resolve(path.join(os.homedir(), ALIAS_DIRECTORY_NAME));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const builtinAliasBaseDir = path.resolve(path.join(__dirname, '..', 'commands', 'aliases'));

/**
 * Recursively scan directory for command files (.md)
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Base directory for relative paths
 * @param {string} namespace - Namespace for commands in the menu
 * @returns {Promise<Array>} Array of command objects
 */
async function scanCommandsDirectory(dir, baseDir, namespace) {
  const commands = [];

  try {
    // Check if directory exists
    await fs.access(dir);

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subCommands = await scanCommandsDirectory(fullPath, baseDir, namespace);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Parse markdown file for metadata
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const { data: frontmatter, content: commandContent } = matter(content);

          // Calculate relative path from baseDir for command name
          const relativePath = path.relative(baseDir, fullPath);
          // Remove .md extension and convert to command name
          const commandName = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

          // Extract description from frontmatter or first line of content
          let description = frontmatter.description || '';
          if (!description) {
            const firstLine = commandContent.trim().split('\n')[0];
            description = firstLine.replace(/^#+\s*/, '').trim();
          }

          commands.push({
            name: commandName,
            path: fullPath,
            relativePath,
            description,
            namespace,
            metadata: frontmatter
          });
        } catch (err) {
          console.error(`Error parsing command file ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be accessed - this is okay
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning directory ${dir}:`, err.message);
    }
  }

  return commands;
}

/**
 * Check whether a file path stays inside one allowed command directory.
 * @param {string} targetPath - Absolute or relative file path
 * @param {string} baseDir - Absolute allowed base directory
 * @returns {boolean} True when the target is inside baseDir
 */
function isPathInsideDirectory(targetPath, baseDir) {
  const resolvedPath = path.resolve(targetPath);
  const relativePath = path.relative(baseDir, resolvedPath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/**
 * Check whether a command file path stays inside one of the configured command directories.
 * @param {string} targetPath - Absolute or relative file path
 * @returns {boolean} True when the target is inside a command directory
 */
function isCommandPathAllowed(targetPath) {
  return isPathInsideDirectory(targetPath, aliasBaseDir)
    || isPathInsideDirectory(targetPath, builtinAliasBaseDir);
}

/**
 * POST /api/commands/list
 * List built-in quick aliases plus user aliases from the global alias directory.
 */
router.post('/list', async (req, res) => {
  try {
    const builtinCommands = await scanCommandsDirectory(
      builtinAliasBaseDir,
      builtinAliasBaseDir,
      BUILTIN_ALIAS_NAMESPACE,
    );
    const aliasCommands = await scanCommandsDirectory(aliasBaseDir, aliasBaseDir, ALIAS_NAMESPACE);
    const commands = [...builtinCommands, ...aliasCommands];
    commands.sort((a, b) => a.name.localeCompare(b.name) || a.namespace.localeCompare(b.namespace));

    res.json({
      commands,
      count: commands.length
    });
  } catch (error) {
    console.error('Error listing commands:', error);
    res.status(500).json({
      error: 'Failed to list commands',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/load
 * Load a specific command file and return its content and metadata
 */
router.post('/load', async (req, res) => {
  try {
    const { commandPath } = req.body;

    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required'
      });
    }

    if (!isCommandPathAllowed(commandPath)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Command must be in ${builtinAliasBaseDir} or ${aliasBaseDir}`
      });
    }

    // Read and parse the command file
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = matter(content);

    res.json({
      path: commandPath,
      metadata,
      content: commandContent
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error loading command:', error);
    res.status(500).json({
      error: 'Failed to load command',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/execute
 * Execute a command with argument replacement
 * This endpoint prepares the command content but doesn't execute bash commands yet
 * (that will be handled in the command parser utility)
 */
router.post('/execute', async (req, res) => {
  try {
    const { commandName, commandPath, args = [] } = req.body;

    if (!commandName) {
      return res.status(400).json({
        error: 'Command name is required'
      });
    }

    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required'
      });
    }

    if (!isCommandPathAllowed(commandPath)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Command must be in ${builtinAliasBaseDir} or ${aliasBaseDir}`
      });
    }

    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = matter(content);
    // Basic argument replacement (will be enhanced in command parser utility)
    let processedContent = commandContent;

    // Replace $ARGUMENTS with all arguments joined
    const argsString = args.join(' ');
    processedContent = processedContent.replace(/\$ARGUMENTS/g, argsString);

    // Replace $1, $2, etc. with positional arguments
    args.forEach((arg, index) => {
      const placeholder = `$${index + 1}`;
      processedContent = processedContent.replace(new RegExp(`\\${placeholder}\\b`, 'g'), arg);
    });

    res.json({
      type: 'alias',
      command: commandName,
      content: processedContent,
      metadata,
      hasFileIncludes: processedContent.includes('@'),
      hasBashCommands: processedContent.includes('!')
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error executing command:', error);
    res.status(500).json({
      error: 'Failed to execute command',
      message: error.message
    });
  }
});

export default router;

export {
  ALIAS_NAMESPACE,
  BUILTIN_ALIAS_NAMESPACE,
  aliasBaseDir,
  builtinAliasBaseDir,
  isCommandPathAllowed,
  scanCommandsDirectory,
};
