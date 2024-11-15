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
const fs_1 = require("fs");
const core = __importStar(require("@actions/core"));
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const rest_1 = require("@octokit/rest");
const parse_diff_1 = __importDefault(require("parse-diff"));
const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY = core.getInput("OPENAI_API_KEY");
const ANTHROPIC_API_KEY = core.getInput("ANTHROPIC_API_KEY");
const AI_PROVIDER = core.getInput("AI_PROVIDER") || "openai";
const OPENAI_API_MODEL = "gpt-4-0125-preview";
const ANTHROPIC_API_MODEL = "claude-3-sonnet-20240229";
const COOKBOOK_URL = "https://gist.githubusercontent.com/herniqeu/35669801a4bbdc8fa52953986fa61277/raw/24932e0a2422f06eb762802ba0efb1e24d11924f/cookbook.md";
const octokit = new rest_1.Octokit({ auth: GITHUB_TOKEN });
const openai = new openai_1.default({
    apiKey: OPENAI_API_KEY,
});
const anthropic = new sdk_1.default({
    apiKey: ANTHROPIC_API_KEY,
});
const SKIP_VALIDATION_COMMENT = '// @skip-validation';
function getPRDetails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { repository, number } = JSON.parse((0, fs_1.readFileSync)(process.env.GITHUB_EVENT_PATH || "", "utf8"));
        const prResponse = yield octokit.pulls.get({
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
        });
        return {
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
            title: (_a = prResponse.data.title) !== null && _a !== void 0 ? _a : "",
            description: (_b = prResponse.data.body) !== null && _b !== void 0 ? _b : "",
        };
    });
}
const logPrefix = {
    info: "🔍",
    warning: "⚠️",
    success: "✅",
    error: "❌",
    debug: "🐛",
    review: "📝"
};
const defaultRules = `Review the Pull Request and provide a verdict on whether it should be approved, requires changes, or is blocked.`;
function getAIResponse(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        console.log(`🤖 Sending request to ${AI_PROVIDER.toUpperCase()}`);
        try {
            let content;
            if (AI_PROVIDER === 'anthropic') {
                const response = yield anthropic.messages.create({
                    model: ANTHROPIC_API_MODEL,
                    max_tokens: 4000,
                    temperature: 0.3,
                    system: prompt.system,
                    messages: [
                        {
                            role: "user",
                            content: prompt.user
                        }
                    ]
                });
                content = response.content[0].type === 'text' ? response.content[0].text : '';
            }
            else {
                const response = yield openai.chat.completions.create({
                    model: OPENAI_API_MODEL,
                    temperature: 0.3,
                    max_tokens: 4000,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content: prompt.system
                        },
                        {
                            role: "user",
                            content: prompt.user
                        }
                    ]
                });
                content = ((_b = (_a = response.choices[0].message) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b.trim()) || "{}";
            }
            console.log('📥 Raw AI response:', content);
            try {
                const parsed = JSON.parse(content);
                console.log('✅ Successfully parsed AI response');
                return parsed;
            }
            catch (parseError) {
                console.error('❌ Failed to parse AI response:', parseError);
                console.log('📄 Problematic content:', content);
                return null;
            }
        }
        catch (error) {
            console.error(`❌ ${AI_PROVIDER.toUpperCase()} API error:`, error);
            return null;
        }
    });
}
function createReviewComment(owner, repo, pull_number, comments) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`${logPrefix.review} Preparing to post ${comments.length} review comments`);
        try {
            const diff = yield getDiff(owner, repo, pull_number);
            const parsedDiff = (0, parse_diff_1.default)(diff);
            const diffPositions = new Map();
            parsedDiff.forEach(file => {
                const positions = [];
                let position = 0;
                file.chunks.forEach(chunk => {
                    chunk.changes.forEach(change => {
                        position++;
                        if (change.type !== 'del') {
                            positions.push({
                                path: file.to || '',
                                position: position,
                                line: 'ln2' in change ? change.ln2 : change.ln,
                            });
                        }
                    });
                });
                diffPositions.set(file.to || '', positions);
            });
            const validComments = comments.map(comment => {
                const filePositions = diffPositions.get(comment.path);
                if (!filePositions) {
                    console.log(`${logPrefix.warning} No diff positions found for file: ${comment.path}`);
                    return null;
                }
                const diffPosition = filePositions.find(pos => pos.line === comment.line);
                if (!diffPosition) {
                    console.log(`${logPrefix.warning} No diff position found for line ${comment.line} in ${comment.path}`);
                    return null;
                }
                return {
                    path: comment.path,
                    body: comment.body,
                    position: diffPosition.position
                };
            }).filter((comment) => comment !== null);
            if (validComments.length === 0) {
                console.log(`${logPrefix.warning} No valid diff positions found for any comments`);
                return;
            }
            console.log(`${logPrefix.review} Posting ${validComments.length} comments (${comments.length - validComments.length} skipped)`);
            yield octokit.pulls.createReview({
                owner,
                repo,
                pull_number,
                event: "COMMENT",
                comments: validComments
            });
            console.log(`${logPrefix.success} Successfully posted review comments`);
        }
        catch (error) {
            console.error(`${logPrefix.error} Error posting review:`, error);
            console.log(`${logPrefix.debug} Attempted to post comments:`, comments.map(c => ({
                path: c.path,
                line: c.line,
                bodyLength: c.body.length
            })));
            throw error;
        }
    });
}
function getDiff(owner, repo, pull_number) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield octokit.pulls.get({
            owner,
            repo,
            pull_number,
            mediaType: {
                format: "diff"
            }
        });
        const diff = response.data;
        return diff;
    });
}
function fetchCookbook(url) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!url) {
                console.log('ℹNo cookbook URL provided, using default rules');
                return defaultRules;
            }
            console.log(`📥 Fetching cookbook from: ${url}`);
            const response = yield fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch cookbook: ${response.statusText}`);
            }
            const rules = yield response.text();
            console.log('✅ Successfully fetched cookbook rules');
            return rules;
        }
        catch (error) {
            console.error('❌ Error fetching cookbook:', error);
            console.log('⚠️ Falling back to default rules');
            return defaultRules;
        }
    });
}
function performTwoStepAnalysis(parsedDiff, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        const filesToAnalyze = parsedDiff.filter(file => {
            const hasSkipComment = file.chunks.some(chunk => chunk.changes.some(change => change.content.includes(SKIP_VALIDATION_COMMENT)));
            if (hasSkipComment) {
                console.log(`🔕 Skipping validation for ${file.to} due to skip comment`);
            }
            return !hasSkipComment;
        });
        if (filesToAnalyze.length === 0) {
            console.log('ℹ️ All files are marked to skip validation');
            return { reviews: [], hasCriticalIssues: false };
        }
        const initialAnalysis = yield getComprehensiveAnalysis(filesToAnalyze, prDetails, cookbook);
        const detailedReviews = yield generateDetailedReviews(initialAnalysis, cookbook);
        const hasCriticalIssues = detailedReviews.some(review => review.severity === 'critical');
        return { reviews: detailedReviews, hasCriticalIssues };
    });
}
function getComprehensiveAnalysis(parsedDiff, prDetails, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        const systemPrompt = `
${cookbook}

You are a code analysis expert. Analyze the provided changes according to the rules and guidelines above.

Provide a structured analysis following this JSON format:
{
  "fileIssues": [{
    "path": "file path",
    "issues": [{
      "lineNumber": number,
      "type": "string",
      "description": "detailed description",
      "suggestedFix": "specific fix",
      "severity": "string",
      "codeBlock": "relevant code"
    }]
  }],
  "globalIssues": [{
    "type": "category",
    "description": "description",
    "affectedFiles": ["files"]
  }]
}`;
        const userPrompt = `
PR Title: ${prDetails.title}
PR Description: ${prDetails.description}

Changed Files:
${JSON.stringify(parsedDiff, null, 2)}`;
        const response = yield getAIResponse({ system: systemPrompt, user: userPrompt });
        if (!response) {
            return { fileIssues: [], globalIssues: [] };
        }
        return response;
    });
}
function generateDetailedReviews(analysis, cookbook) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const reviews = [];
        for (const fileIssue of analysis.fileIssues) {
            for (const issue of fileIssue.issues) {
                const reviewPrompt = {
                    system: `
${cookbook}

You are a code review expert. Follow Conventional Comments format strictly:
<label> [decorations]: <subject>

[discussion]

Labels: praise, nitpick, suggestion, issue, todo, question, thought, chore, note
Decorations: (blocking), (non-blocking), (if-minor)

IMPORTANT:
- Be concise and actionable
- Replace "you" with "we"
- Replace "should" with "could"
- If suggesting code changes, provide exact code in the suggestion
- Keep suggestions minimal and focused

Response format must be JSON:
{
  "severity": "critical|warning|info",
  "analysis": "your conventional comment",
  "suggestion": "exact replacement code"
}`,
                    user: `
Issue Type: ${issue.type}
File: ${fileIssue.path}
Line: ${issue.lineNumber}
Description: ${issue.description}
Code: ${issue.codeBlock}`
                };
                const response = yield getAIResponse(reviewPrompt);
                if (!response)
                    continue;
                reviews.push({
                    path: fileIssue.path,
                    lineNumber: issue.lineNumber,
                    severity: (_a = response.severity) !== null && _a !== void 0 ? _a : 'info',
                    analysis: (_b = response.analysis) !== null && _b !== void 0 ? _b : 'No analysis',
                    suggestion: (_c = response.suggestion) !== null && _c !== void 0 ? _c : ''
                });
            }
        }
        return reviews;
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🚀 Starting validation process');
        try {
            const prDetails = yield getPRDetails();
            console.log(`📋 Analyzing PR #${prDetails.pull_number} in ${prDetails.owner}/${prDetails.repo}`);
            const cookbook = yield fetchCookbook(COOKBOOK_URL);
            console.log('✅ Cookbook loaded successfully');
            const diff = yield getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
            if (!diff) {
                console.log("❌ No diff found");
                return;
            }
            const parsedDiff = (0, parse_diff_1.default)(diff);
            const { reviews, hasCriticalIssues } = yield performTwoStepAnalysis(parsedDiff, prDetails, cookbook);
            if (reviews.length > 0) {
                console.log('📤 Posting review comments');
                yield createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, reviews.map(review => ({
                    body: `${review.analysis}\n\n${review.suggestion ?
                        `\`\`\`suggestion
${review.suggestion}
\`\`\`\n` : ''}`,
                    path: review.path,
                    line: review.lineNumber
                })));
                if (hasCriticalIssues) {
                    yield octokit.pulls.createReview({
                        owner: prDetails.owner,
                        repo: prDetails.repo,
                        pull_number: prDetails.pull_number,
                        event: "REQUEST_CHANGES",
                        body: "Changes requested based on critical issues found in review."
                    });
                    core.setFailed("Critical issues found in the PR");
                }
                console.log('✅ Review comments posted successfully');
            }
        }
        catch (error) {
            console.error('❌ Main process error:', error);
            throw error;
        }
    });
}
main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map