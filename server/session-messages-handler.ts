// @ts-nocheck -- Extracted from server/index.ts for testability.
/**
 * Session messages HTTP handler — extracted from server/index.ts so both the
 * Express route and integration tests call the same implementation.
 */
import { extractProjectDirectory, getManualSessionDraftRuntime, getCodexSessions, getPiSessions, getCodexSessionMessages } from './projects.js';
import { readCoConversationMessages, findCoConversationForSession } from './co-read-model.js';

const CC_ROUTE_SESSION_PATTERN = /^c\d+$/;

function isCcflowRouteSessionId(sessionId) {
    return typeof sessionId === 'string' && CC_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

/**
 * Handle GET /api/projects/:projectName/sessions/:sessionId/messages
 *
 * Resolves the provider from the query string (or guesses from session indexes),
 * then reads messages from the appropriate source (co conversation read model
 * for pi/opencode, native Codex JSONL for codex).
 */
export async function handleGetSessionMessages(req, res) {
    try {
        const { projectName, sessionId } = req.params;
        const { limit, offset, provider, afterLine } = req.query;

        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;
        const parsedAfterLine = afterLine != null ? parseInt(afterLine, 10) : null;

        let resolvedProvider = provider === 'opencode' ? 'opencode' : provider === 'codex' ? 'codex' : provider === 'pi' ? 'pi' : null;
        let projectPath = null;

        if (isCcflowRouteSessionId(sessionId)) {
            projectPath = await extractProjectDirectory(projectName);
            const runtimeContext = await getManualSessionDraftRuntime(
                projectName,
                projectPath,
                sessionId,
            );

            // cN route sessions always read from the co conversation read model
            // first, because the cN session id IS the co conversation_id.  Only
            // fall back to the generic path when no co conversation exists and
            // no manual draft runtimeContext provides a provider session id.
            const cNProvider = resolvedProvider
                || (runtimeContext?.provider === 'opencode' ? 'opencode'
                    : runtimeContext?.provider === 'pi' ? 'pi'
                    : 'codex');

            const coConversation = await findCoConversationForSession(sessionId, cNProvider);
            if (coConversation) {
                return res.json(await readCoConversationMessages(
                    coConversation,
                    cNProvider,
                    parsedLimit,
                    parsedAfterLine ?? parsedOffset,
                ));
            }

            if (runtimeContext) {
                if (!runtimeContext.pendingProviderSessionId) {
                    return res.json({ messages: [] });
                }

                const providerSessionId = runtimeContext.pendingProviderSessionId;

                const nativeResult = cNProvider === 'codex'
                    ? await getCodexSessionMessages(providerSessionId, parsedLimit, parsedOffset, parsedAfterLine)
                    : await readCoConversationMessages(
                        coConversation,
                        cNProvider === 'pi' ? 'pi' : 'opencode',
                        parsedLimit,
                        parsedOffset,
                    );
                return res.json(nativeResult);
            }

            // No co conversation and no runtimeContext: let the generic path
            // try native Codex JSONL for the cN session id as last resort.
        }

        if (!resolvedProvider) {
            try {
                projectPath = projectPath || await extractProjectDirectory(projectName);
                const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
                if (codexSessions.some((session) => session.id === sessionId)) {
                    resolvedProvider = 'codex';
                } else {
                    const piSessions = await getPiSessions(projectPath);
                    resolvedProvider = piSessions.some((session) => session.id === sessionId) ? 'pi' : 'opencode';
                }
            } catch (providerDetectionError) {
                console.warn(
                    `Unable to detect provider for session ${sessionId} in project ${projectName}:`,
                    providerDetectionError.message,
                );
                resolvedProvider = 'codex';
            }
        }

        // Non-cN codex sessions always read from native Codex JSONL.
        // Co conversations have cN route IDs (isCcflowRouteSessionId), so
        // any session reaching this branch is NOT co-owned for codex.
        const nonCodexProvider = resolvedProvider === 'pi' ? 'pi' : 'opencode';
        const result = resolvedProvider === 'codex'
            ? await getCodexSessionMessages(sessionId, parsedLimit, parsedOffset, parsedAfterLine)
            : await readCoConversationMessages(
                await findCoConversationForSession(sessionId, nonCodexProvider),
                nonCodexProvider,
                parsedLimit,
                parsedOffset,
            );

        // Handle both old and new response formats
        if (Array.isArray(result)) {
            res.json({ messages: result });
        } else {
            res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
