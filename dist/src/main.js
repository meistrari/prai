"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const core = __importStar(require("@actions/core"));
const anthropic_1 = require("@ai-sdk/anthropic");
const openai_1 = require("@ai-sdk/openai");
const rest_1 = require("@octokit/rest");
const ai_1 = require("ai");
const dedent_1 = __importDefault(require("dedent"));
const neverthrow_1 = require("neverthrow");
const parse_diff_1 = __importDefault(require("parse-diff"));
const zod_1 = __importDefault(require("zod"));
const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const OPENAI_API_KEY = core.getInput('OPENAI_API_KEY');
const ANTHROPIC_API_KEY = core.getInput('ANTHROPIC_API_KEY');
const AI_PROVIDER = core.getInput('AI_PROVIDER') || 'openai';
const COOKBOOK_URL = 'https://gist.githubusercontent.com/herniqeu/35669801a4bbdc8fa52953986fa61277/raw/24932e0a2422f06eb762802ba0efb1e24d11924f/cookbook.md';
const octokit = new rest_1.Octokit({ auth: GITHUB_TOKEN });
const SKIP_VALIDATION_COMMENT = '// @skip-validation';
const logger = {
    info: (message, ...args) => {
        // eslint-disable-next-line no-console
        console.log(`🔍 ${message}`, ...args);
        core.info(message);
    },
    warn: (message, ...args) => {
        // eslint-disable-next-line no-console
        console.log(`⚠️ ${message}`, ...args);
        core.warning(message);
    },
    error: (message, ...args) => {
        console.error(`❌ ${message}`, ...args);
        core.error(message);
    },
    debug: (message, ...args) => {
        // eslint-disable-next-line no-console
        console.log(`🐛 ${message}`, ...args);
        core.debug(message);
    },
    success: (message, ...args) => {
        // eslint-disable-next-line no-console
        console.log(`✅ ${message}`, ...args);
        core.info(message);
    },
    review: (message, ...args) => {
        // eslint-disable-next-line no-console
        console.log(`📝 ${message}`, ...args);
        core.info(message);
    },
};
function getPRDetails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { repository, number } = JSON.parse((0, node_fs_1.readFileSync)(process.env.GITHUB_EVENT_PATH || '', 'utf8'));
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
    var _a;
    const modelPerProvider = {
        openai: (0, openai_1.createOpenAI)({ apiKey: OPENAI_API_KEY })('gpt-4-0125-preview'),
        anthropic: (0, anthropic_1.createAnthropic)({ apiKey: ANTHROPIC_API_KEY })('claude-3-5-sonnet-20241022'),
    };
    return (_a = modelPerProvider[AI_PROVIDER]) !== null && _a !== void 0 ? _a : modelPerProvider.openai;
}
function getAIResponse(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        logger.info(`Sending request to ${AI_PROVIDER.toUpperCase()}`);
        try {
            const options = {
                model: resolveModel(),
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
            const response = yield neverthrow_1.ResultAsync.fromPromise((0, ai_1.generateText)(options), (error) => {
                logger.error(`${AI_PROVIDER.toUpperCase()} API error:`, error);
                return error;
            });
            if (response.isErr()) {
                logger.error(`Failed to generate text:`, response.error);
                return (0, neverthrow_1.err)(response.error);
            }
            if ((_b = (_a = response.value.toolCalls) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.args) {
                logger.debug('Tool call response:', JSON.stringify(response.value.toolCalls[0].args, null, 2));
                return (0, neverthrow_1.ok)(response.value.toolCalls[0].args);
            }
            if (response.value.text) {
                logger.debug('Text response:', response.value.text);
                return (0, neverthrow_1.ok)(response.value.text);
            }
            return (0, neverthrow_1.err)(new Error('No valid response content found'));
        }
        catch (error) {
            logger.error('Unexpected error in getAIResponse:', error);
            return (0, neverthrow_1.err)(error);
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
                return (0, neverthrow_1.err)(diff.error);
            }
            const parsedDiff = (0, parse_diff_1.default)(diff.value);
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
                return (0, neverthrow_1.ok)(undefined);
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
            return (0, neverthrow_1.ok)(undefined);
        }
        catch (error) {
            logger.error(`Error posting review:`, error);
            logger.debug(`Attempted to post comments:`, comments.map(c => ({
                path: c.path,
                line: c.line,
                bodyLength: c.body.length,
            })));
            return (0, neverthrow_1.err)(error);
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
            return (0, neverthrow_1.ok)(diff);
        }
        catch (error) {
            logger.error(`Error fetching diff:`, error);
            return (0, neverthrow_1.err)(error);
        }
    });
}
function fetchCookbook(url) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!url) {
            logger.info(`No cookbook URL provided, using default rules`);
            return (0, neverthrow_1.ok)(defaultRules);
        }
        logger.info(`Fetching cookbook from: ${url}`);
        try {
            const response = yield fetch(url);
            if (!response.ok) {
                return (0, neverthrow_1.err)(new Error(`Failed to fetch cookbook: ${response.statusText}`));
            }
            const rules = yield response.text();
            logger.success(`Successfully fetched cookbook rules`);
            return (0, neverthrow_1.ok)(rules);
        }
        catch (error) {
            logger.error(`Error fetching cookbook:`, error);
            logger.warn(`Falling back to default rules`);
            return (0, neverthrow_1.ok)(defaultRules);
        }
    });
}
function performSingleFileAnalysis(file, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        const hasSkipComment = file.chunks.some(chunk => chunk.changes.some(change => change.content.includes(SKIP_VALIDATION_COMMENT)));
        if (hasSkipComment) {
            logger.info(`Skipping validation for ${file.to} due to skip comment`);
            return (0, neverthrow_1.ok)({ reviews: [], hasCriticalIssues: false });
        }
        return neverthrow_1.ResultAsync.fromPromise((() => __awaiter(this, void 0, void 0, function* () {
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
            system: (0, dedent_1.default) `
          ${cookbook}

          You are a code analysis expert. Analyze the provided changes according to the rules and guidelines above.
        `,
            user: (0, dedent_1.default) `
          PR Title: ${prDetails.title}
          PR Description: ${prDetails.description}

          Changed Files:
              ${JSON.stringify(parsedDiff, null, 2)}
        `,
            format: zod_1.default.object({
                fileIssues: zod_1.default.array(zod_1.default.object({
                    path: zod_1.default.string().describe('The path of the file'),
                    issues: zod_1.default.array(zod_1.default.object({
                        lineNumber: zod_1.default.number().describe('The line number of the issue'),
                        type: zod_1.default.string().describe('The type of the issue'),
                        description: zod_1.default.string().describe('A detailed description of the issue'),
                        suggestedFix: zod_1.default.string().describe('A specific fix for the issue'),
                        severity: zod_1.default.string().describe('The severity of the issue'),
                        codeBlock: zod_1.default.string().describe('The relevant code block'),
                    })),
                })).describe('The issues found in the files'),
                globalIssues: zod_1.default.array(zod_1.default.object({
                    type: zod_1.default.string().describe('The type of the global issue'),
                    description: zod_1.default.string().describe('A detailed description of the global issue'),
                    affectedFiles: zod_1.default.array(zod_1.default.string()).describe('A list of files affected by the global issue'),
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
                    system: (0, dedent_1.default) `
                  ${cookbook}

                  You are a code review expert. Follow Conventional Comments format strictly:

                  Labels: praise, nitpick, suggestion, issue, todo, question, thought, chore, note
                  Decorations: (blocking), (non-blocking), (if-minor)

                  IMPORTANT:
                  - Be concise and actionable
                  - Replace "you" with "we"
                  - Replace "should" with "could"
                  - If suggesting code changes, provide exact code in the suggestion
                  - Keep suggestions minimal and focused
                `,
                    user: (0, dedent_1.default) `
                  Issue Type: ${issue.type}
                  File: ${fileIssue.path}
                  Line: ${issue.lineNumber}
                  Description: ${issue.description}
                  Code: ${issue.codeBlock}
                `,
                    format: zod_1.default.object({
                        severity: zod_1.default.enum(['critical', 'warning', 'info']).describe('The severity of the issue'),
                        analysis: zod_1.default.string().describe('A detailed analysis of the issue'),
                        suggestion: zod_1.default.string().describe('A specific fix for the issue'),
                    }),
                };
                const response = yield getAIResponse(reviewPrompt);
                if (response.isErr()) {
                    logger.error(`Failed to generate detailed review:`, response.error);
                    continue;
                }
                if (!response.value) {
                    continue;
                }
                reviews.push({
                    path: fileIssue.path,
                    lineNumber: issue.lineNumber,
                    severity: (_a = response.value.severity) !== null && _a !== void 0 ? _a : 'info',
                    analysis: (_b = response.value.analysis) !== null && _b !== void 0 ? _b : 'No analysis',
                    suggestion: (_c = response.value.suggestion) !== null && _c !== void 0 ? _c : '',
                });
            }
        }
        return reviews;
    });
}
function generateFinalSummary(fileResults, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        const summaryPrompt = {
            system: (0, dedent_1.default) `
            ${cookbook}

            You are a technical lead reviewing a pull request. Analyze the provided review results and create a comprehensive summary.
            Consider:
            1. Overall impact of changes
            2. Patterns in issues found
            3. Critical problems that need immediate attention
            4. General suggestions for improvement
            `,
            user: (0, dedent_1.default) `
            PR Title: ${prDetails.title}
            PR Description: ${prDetails.description}

            File Analysis Results:
            ${JSON.stringify(fileResults, null, 2)}
        `,
            format: zod_1.default.object({
                overallVerdict: zod_1.default.object({
                    status: zod_1.default.enum(['approve', 'request_changes', 'comment']).describe('The overall status of the PR'),
                    summary: zod_1.default.string().describe('A concise summary of the PR'),
                    criticalIssues: zod_1.default.array(zod_1.default.string()).describe('A list of critical issues found in the PR'),
                    warnings: zod_1.default.array(zod_1.default.string()).describe('A list of warnings found in the PR'),
                    suggestions: zod_1.default.array(zod_1.default.string()).describe('A list of suggestions for the PR'),
                }).describe('The overall verdict of the PR'),
            }),
        };
        const response = yield getAIResponse(summaryPrompt);
        if (response.isErr() || !response.value.overallVerdict) {
            return (0, neverthrow_1.err)(new Error('Failed to generate summary or missing verdict'));
        }
        return (0, neverthrow_1.ok)({
            fileResults,
            overallVerdict: response.value.overallVerdict,
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
            const parsedDiff = (0, parse_diff_1.default)(diff.value);
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
                        body: (0, dedent_1.default) `
                            ${review.analysis}
                            
                            ${review.suggestion
                            ? (0, dedent_1.default) `
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
                body: (0, dedent_1.default) `
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