var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { readFileSync } from 'node:fs';
import * as core from '@actions/core';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { Octokit } from '@octokit/rest';
import { generateText } from 'ai';
import dedent from 'dedent';
import { err, ok, ResultAsync } from 'neverthrow';
import parseDiff from 'parse-diff';
import z from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
if (typeof globalThis.TransformStream === 'undefined') {
    globalThis.TransformStream = TransformStream;
}
const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const OPENAI_API_KEY = core.getInput('OPENAI_API_KEY');
const ANTHROPIC_API_KEY = core.getInput('ANTHROPIC_API_KEY');
const AI_PROVIDER = core.getInput('AI_PROVIDER') || 'google';
const COOKBOOK_URL = 'https://gist.githubusercontent.com/herniqeu/35669801a4bbdc8fa52953986fa61277/raw/24932e0a2422f06eb762802ba0efb1e24d11924f/cookbook.md';
const GOOGLE_API_KEY = core.getInput('GOOGLE_API_KEY');
const octokit = new Octokit({ auth: GITHUB_TOKEN });
const SKIP_VALIDATION_COMMENT = '// @skip-validation';
const logger = {
    info: (message, ...args) => {
        core.info(`🔍 ${message}`);
    },
    warn: (message, ...args) => {
        core.warning(`⚠️ ${message}`);
    },
    error: (message, ...args) => {
        core.error(`❌ ${message}`);
    },
    debug: (message, ...args) => {
        core.debug(`🐛 ${message}`);
    },
    success: (message, ...args) => {
        core.info(`✅ ${message}`);
    },
    review: (message, ...args) => {
        core.info(`📝 ${message}`);
    },
};
function getPRDetails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { repository, number } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH || '', 'utf8'));
        const prResponse = yield octokit.pulls.get({
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
        });
        return {
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
            title: (_a = prResponse.data.title) !== null && _a !== void 0 ? _a : '',
            description: (_b = prResponse.data.body) !== null && _b !== void 0 ? _b : '',
        };
    });
}
const defaultRules = `Review the Pull Request and provide a verdict on whether it should be approved, requires changes, or is blocked.`;
function resolveModel() {
    logger.debug(`Resolving AI model for provider: ${AI_PROVIDER}`);
    logger.debug(`API Key present: ${!!GOOGLE_API_KEY}`);
    const modelPerProvider = {
        openai: createOpenAI({ apiKey: OPENAI_API_KEY })('gpt-4o-2024-08-06'),
        anthropic: createAnthropic({ apiKey: ANTHROPIC_API_KEY })('claude-3-5-sonnet-20241022'),
        google: createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY })('models/gemini-1.5-pro-001')
    };
    const model = modelPerProvider[AI_PROVIDER];
    if (!model) {
        throw new Error(`Invalid AI provider: ${AI_PROVIDER}`);
    }
    logger.debug(`Model resolved successfully for ${AI_PROVIDER}`);
    return model;
}
function getAIResponse(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        logger.info(`Sending request to ${AI_PROVIDER.toUpperCase()}`);
        try {
            const model = yield resolveModel();
            logger.info(`Model configuration: ${JSON.stringify(model, null, 2)}`);
            const options = {
                model,
                system: prompt.system,
                prompt: prompt.user,
            };
            if (prompt.format) {
                options.tools = {
                    responseFormat: {
                        parameters: prompt.format,
                        description: 'Always use this schema to format your response.',
                    },
                };
                options.toolChoice = { toolName: 'responseFormat', type: 'tool' };
            }
            logger.info(`Sending request to ${AI_PROVIDER.toUpperCase()}:`, JSON.stringify(options, null, 2));
            const response = yield ResultAsync.fromPromise(generateText(options), (error) => {
                var _a, _b, _c;
                logger.error('API Error Details:', {
                    name: error.name,
                    message: error.message,
                    response: (_a = error.response) === null || _a === void 0 ? void 0 : _a.data,
                    status: (_b = error.response) === null || _b === void 0 ? void 0 : _b.status,
                    headers: (_c = error.response) === null || _c === void 0 ? void 0 : _c.headers,
                    stack: error.stack,
                    raw: error
                });
                return error;
            });
            logger.info(`Received response from ${AI_PROVIDER.toUpperCase()}:`, JSON.stringify(response, null, 2));
            if (response.isErr()) {
                return err(response.error);
            }
            // Add validation for the response format
            if ((_b = (_a = response.value.toolCalls) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.args) {
                const args = response.value.toolCalls[0].args;
                logger.info('Validating tool call response:', JSON.stringify(args, null, 2));
                return ok(args);
            }
            if (response.value.text) {
                logger.info('Validating text response:', response.value.text);
                return ok(response.value.text);
            }
            return err(new Error('No valid response content found'));
        }
        catch (error) {
            logger.error('Unexpected error:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
                cause: error.cause,
                raw: error
            });
            return err(error);
        }
    });
}
function createReviewComment(owner, repo, pull_number, comments) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.review(`Preparing to post ${comments.length} review comments`);
        try {
            const diff = yield getDiff(owner, repo, pull_number);
            if (diff.isErr()) {
                logger.error('Failed to fetch diff:', diff.error);
                return err(diff.error);
            }
            const parsedDiff = parseDiff(diff.value);
            const diffPositions = new Map();
            parsedDiff.forEach((file) => {
                const positions = [];
                let position = 0;
                file.chunks.forEach((chunk) => {
                    chunk.changes.forEach((change) => {
                        position++;
                        if (change.type !== 'del') {
                            positions.push({
                                path: file.to || '',
                                position,
                                line: 'ln2' in change ? change.ln2 : change.ln,
                            });
                        }
                    });
                });
                diffPositions.set(file.to || '', positions);
            });
            const validComments = comments.map((comment) => {
                const filePositions = diffPositions.get(comment.path);
                if (!filePositions) {
                    logger.warn(`No diff positions found for file: ${comment.path}`);
                    return null;
                }
                const diffPosition = filePositions.find(pos => pos.line === comment.line);
                if (!diffPosition) {
                    logger.warn(`No diff position found for line ${comment.line} in ${comment.path}`);
                    return null;
                }
                return {
                    path: comment.path,
                    body: comment.body,
                    position: diffPosition.position,
                };
            }).filter((comment) => comment !== null);
            if (validComments.length === 0) {
                logger.warn(`No valid diff positions found for any comments`);
                return ok(undefined);
            }
            logger.review(`Posting ${validComments.length} comments (${comments.length - validComments.length} skipped)`);
            yield octokit.pulls.createReview({
                owner,
                repo,
                pull_number,
                event: 'COMMENT',
                comments: validComments,
            });
            logger.success(`Successfully posted review comments`);
            return ok(undefined);
        }
        catch (error) {
            logger.error(`Error posting review:`, error);
            logger.debug(`Attempted to post comments:`, comments.map(c => ({
                path: c.path,
                line: c.line,
                bodyLength: c.body.length,
            })));
            return err(error);
        }
    });
}
function getDiff(owner, repo, pull_number) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield octokit.pulls.get({
                owner,
                repo,
                pull_number,
                mediaType: {
                    format: 'diff',
                },
            });
            const diff = response.data;
            return ok(diff);
        }
        catch (error) {
            logger.error(`Error fetching diff:`, error);
            return err(error);
        }
    });
}
function fetchCookbook(url) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!url) {
            logger.info(`No cookbook URL provided, using default rules`);
            return ok(defaultRules);
        }
        logger.info(`Fetching cookbook from: ${url}`);
        try {
            const response = yield fetch(url);
            if (!response.ok) {
                return err(new Error(`Failed to fetch cookbook: ${response.statusText}`));
            }
            const rules = yield response.text();
            logger.success(`Successfully fetched cookbook rules`);
            return ok(rules);
        }
        catch (error) {
            logger.error(`Error fetching cookbook:`, error);
            logger.warn(`Falling back to default rules`);
            return ok(defaultRules);
        }
    });
}
function performSingleFileAnalysis(file, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        const hasSkipComment = file.chunks.some(chunk => chunk.changes.some(change => change.content.includes(SKIP_VALIDATION_COMMENT)));
        if (hasSkipComment) {
            logger.info(`Skipping validation for ${file.to} due to skip comment`);
            return ok({ reviews: [], hasCriticalIssues: false });
        }
        return ResultAsync.fromPromise((() => __awaiter(this, void 0, void 0, function* () {
            const initialAnalysis = yield getComprehensiveAnalysis([file], prDetails, cookbook);
            const detailedReviews = yield generateDetailedReviews(initialAnalysis, cookbook);
            const hasCriticalIssues = detailedReviews.some(review => review.severity === 'critical');
            return { reviews: detailedReviews, hasCriticalIssues };
        }))(), error => error);
    });
}
function getComprehensiveAnalysis(parsedDiff, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        const prompt = {
            system: dedent `
          ${cookbook}

          You are a code analysis expert. Analyze the provided changes according to the rules and guidelines above.
        `,
            user: dedent `
          PR Title: ${prDetails.title}
          PR Description: ${prDetails.description}

          Changed Files:
              ${JSON.stringify(parsedDiff, null, 2)}
        `,
            format: z.object({
                fileIssues: z.array(z.object({
                    path: z.string().describe('The path of the file'),
                    issues: z.array(z.object({
                        lineNumber: z.number().describe('The line number of the issue'),
                        type: z.string().describe('The type of the issue'),
                        description: z.string().describe('A detailed description of the issue'),
                        suggestedFix: z.string().describe('A specific fix for the issue'),
                        severity: z.string().describe('The severity of the issue'),
                        codeBlock: z.string().describe('The relevant code block'),
                    })),
                })).describe('The issues found in the files'),
                globalIssues: z.array(z.object({
                    type: z.string().describe('The type of the global issue'),
                    description: z.string().describe('A detailed description of the global issue'),
                    affectedFiles: z.array(z.string()).describe('A list of files affected by the global issue'),
                })).describe('The global issues found in the PR'),
            }),
        };
        const response = yield getAIResponse(prompt);
        if (response.isErr()) {
            logger.error(`Failed to generate comprehensive analysis:`, response.error);
            return { fileIssues: [], globalIssues: [] };
        }
        return response.value;
    });
}
function generateDetailedReviews(analysis, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const reviews = [];
        for (const fileIssue of analysis.fileIssues) {
            for (const issue of fileIssue.issues) {
                const reviewPrompt = {
                    system: dedent `
                  ${cookbook}

                  You are a code review expert. Follow these severity levels EXACTLY as shown:
                  - "critical" for blocking issues
                  - "warning" for non-blocking issues
                  - "info" for suggestions and improvements

                  IMPORTANT: Severity MUST be lowercase and EXACTLY one of: critical, warning, info
                `,
                    user: dedent `
                  Issue Type: ${issue.type}
                  File: ${fileIssue.path}
                  Line: ${issue.lineNumber}
                  Description: ${issue.description}
                  Code: ${issue.codeBlock}
                `,
                    format: z.object({
                        severity: z.enum(['critical', 'warning', 'info'])
                            .describe('The severity level (must be lowercase: critical, warning, or info)'),
                        analysis: z.string()
                            .describe('A detailed analysis of the issue'),
                        suggestion: z.string()
                            .describe('A specific fix for the issue'),
                    }).strict(), // Add strict() to ensure no extra properties
                };
                try {
                    const response = yield getAIResponse(reviewPrompt);
                    if (response.isErr()) {
                        logger.error(`Failed to generate detailed review for ${fileIssue.path}:${issue.lineNumber}`, response.error);
                        continue;
                    }
                    if (!response.value) {
                        logger.warn(`Empty response for ${fileIssue.path}:${issue.lineNumber}`);
                        continue;
                    }
                    // Normalize severity to lowercase and validate
                    const severity = (response.value.severity || '').toLowerCase();
                    if (!['critical', 'warning', 'info'].includes(severity)) {
                        logger.warn(`Invalid severity "${severity}" for ${fileIssue.path}:${issue.lineNumber}, defaulting to "info"`);
                        response.value.severity = 'info';
                    }
                    reviews.push({
                        path: fileIssue.path,
                        lineNumber: issue.lineNumber,
                        severity: normalizeSeverity((_a = response.value.severity) !== null && _a !== void 0 ? _a : 'info'),
                        analysis: (_b = response.value.analysis) !== null && _b !== void 0 ? _b : 'No analysis provided',
                        suggestion: (_c = response.value.suggestion) !== null && _c !== void 0 ? _c : '',
                    });
                }
                catch (error) {
                    logger.error(`Error processing review for ${fileIssue.path}:${issue.lineNumber}:`, error);
                    continue;
                }
            }
        }
        return reviews;
    });
}
function normalizeStatus(status) {
    const normalized = status.toLowerCase();
    if (['approve', 'request_changes', 'comment'].includes(normalized)) {
        return normalized;
    }
    // Default to request_changes if invalid
    return 'request_changes';
}
function normalizeSeverity(severity) {
    const normalized = severity.toLowerCase();
    if (['critical', 'warning', 'info'].includes(normalized)) {
        return normalized;
    }
    return 'info'; // Default to info if invalid
}
function generateFinalSummary(fileResults, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        const summaryPrompt = {
            system: dedent `
            ${cookbook}

            You are a technical lead reviewing a pull request. Analyze the provided review results and create a comprehensive summary.
            
            The status MUST be EXACTLY one of these lowercase values:
            - "request_changes" for PRs with critical issues
            - "comment" for PRs with warnings or suggestions
            - "approve" for PRs with no issues

            Consider:
            1. Overall impact of changes
            2. Patterns in issues found
            3. Critical problems that need immediate attention
            4. General suggestions for improvement
        `,
            user: dedent `
            PR Title: ${prDetails.title}
            PR Description: ${prDetails.description}

            File Analysis Results:
            ${JSON.stringify(fileResults, null, 2)}
        `,
            format: z.object({
                overallVerdict: z.object({
                    status: z.enum(['approve', 'request_changes', 'comment']).describe('The overall status of the PR'),
                    summary: z.string().describe('A concise summary of the PR'),
                    criticalIssues: z.array(z.string()).describe('A list of critical issues found in the PR'),
                    warnings: z.array(z.string()).describe('A list of warnings found in the PR'),
                    suggestions: z.array(z.string()).describe('A list of suggestions for the PR'),
                }).describe('The overall verdict of the PR'),
            }),
        };
        const response = yield getAIResponse(summaryPrompt);
        if (response.isErr() || !response.value.overallVerdict) {
            return err(new Error('Failed to generate summary or missing verdict'));
        }
        return ok({
            fileResults,
            overallVerdict: Object.assign(Object.assign({}, response.value.overallVerdict), { status: normalizeStatus(response.value.overallVerdict.status) }),
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info(`Starting validation process`);
        try {
            const prDetails = yield getPRDetails();
            logger.info(`Analyzing PR #${prDetails.pull_number} in ${prDetails.owner}/${prDetails.repo}`);
            const cookbook = yield fetchCookbook(COOKBOOK_URL);
            if (cookbook.isErr()) {
                logger.error(`Failed to fetch cookbook:`, cookbook.error);
                return;
            }
            logger.success(`Cookbook loaded successfully`);
            const diff = yield getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
            if (diff.isErr()) {
                logger.error(`Failed to fetch diff:`, diff.error);
                return;
            }
            const parsedDiff = parseDiff(diff.value);
            const fileResults = [];
            for (const file of parsedDiff) {
                const analysis = yield performSingleFileAnalysis(file, prDetails, cookbook.value);
                if (analysis.isErr()) {
                    logger.error(`Failed to analyze file ${file.to}:`, analysis.error);
                    continue;
                }
                fileResults.push({
                    path: file.to || '',
                    reviews: analysis.value.reviews,
                    hasCriticalIssues: analysis.value.hasCriticalIssues,
                });
            }
            const fullContextAnalysis = yield getComprehensiveAnalysis(parsedDiff, prDetails, cookbook.value);
            const fullContextReviews = yield generateDetailedReviews(fullContextAnalysis, cookbook.value);
            for (const review of fullContextReviews) {
                const fileResult = fileResults.find(f => f.path === review.path);
                if (fileResult) {
                    fileResult.reviews.push(review);
                    fileResult.hasCriticalIssues = fileResult.hasCriticalIssues || review.severity === 'critical';
                }
            }
            const finalSummary = yield generateFinalSummary(fileResults, prDetails, cookbook.value);
            if (finalSummary.isErr()) {
                logger.error(`Failed to generate final summary:`, finalSummary.error);
                return;
            }
            for (const fileResult of finalSummary.value.fileResults) {
                if (fileResult.reviews.length > 0) {
                    logger.info(`Posting review comments for ${fileResult.path}`);
                    yield createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, fileResult.reviews.map(review => ({
                        body: dedent `
                            ${review.analysis}
                            
                            ${review.suggestion
                            ? dedent `
                                    \`\`\`suggestion
                                    ${review.suggestion}
                                    \`\`\`\n
                                `
                            : ''}`,
                        path: fileResult.path,
                        line: review.lineNumber,
                    })));
                }
            }
            const hasCriticalIssues = finalSummary.value.overallVerdict.criticalIssues.length > 0;
            const reviewEvent = hasCriticalIssues ? 'REQUEST_CHANGES' : 'COMMENT';
            yield octokit.pulls.createReview({
                owner: prDetails.owner,
                repo: prDetails.repo,
                pull_number: prDetails.pull_number,
                event: reviewEvent,
                body: dedent `
                # Pull Request Review Summary

                ${finalSummary.value.overallVerdict.summary}

                ${finalSummary.value.overallVerdict.criticalIssues.length > 0
                    ? `## Critical Issues
                   ${finalSummary.value.overallVerdict.criticalIssues.map(issue => `- ${issue}`).join('\n')}`
                    : ''}

                ${finalSummary.value.overallVerdict.warnings.length > 0
                    ? `## Warnings
                   ${finalSummary.value.overallVerdict.warnings.map(warning => `- ${warning}`).join('\n')}`
                    : ''}

                ${finalSummary.value.overallVerdict.suggestions.length > 0
                    ? `## Suggestions
                   ${finalSummary.value.overallVerdict.suggestions.map(suggestion => `- ${suggestion}`).join('\n')}`
                    : ''}
            `,
            });
            if (hasCriticalIssues) {
                core.setFailed(`Critical issues found in the PR`);
            }
            logger.success(`Review completed successfully`);
        }
        catch (error) {
            logger.error(`Main process error:`, error);
            throw error;
        }
    });
}
main().catch((error) => {
    logger.error(`Error:`, error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map