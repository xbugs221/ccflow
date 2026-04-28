/**
 * Serve quick-alias markdown commands from the global ~/.config/ccflow-alias directory.
 */
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';

const router = express.Router();
const ALIAS_DIRECTORY_NAME = path.join('.config', 'ccflow-alias');
const ALIAS_NAMESPACE = 'alias';
const aliasBaseDir = path.resolve(path.join(os.homedir(), ALIAS_DIRECTORY_NAME));

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
 * Check whether a file path stays inside the configured global alias directory.
 * @param {string} targetPath - Absolute or relative file path
 * @returns {boolean} True when the target is inside ~/.config/ccflow-alias
 */
function isAliasPathAllowed(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const relativePath = path.relative(aliasBaseDir, resolvedPath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/**
 * POST /api/commands/list
 * List all available quick aliases from the global alias directory.
 */
router.post('/list', async (req, res) => {
  try {
    const aliasCommands = await scanCommandsDirectory(aliasBaseDir, aliasBaseDir, ALIAS_NAMESPACE);
    aliasCommands.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      commands: aliasCommands,
      count: aliasCommands.length
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

    if (!isAliasPathAllowed(commandPath)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Command must be in ${aliasBaseDir}`
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

    if (!isAliasPathAllowed(commandPath)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Command must be in ${aliasBaseDir}`
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
