import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from "@octokit/rest";
import parseDiff, { File } from "parse-diff";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const ANTHROPIC_API_KEY: string = core.getInput("ANTHROPIC_API_KEY");
const AI_PROVIDER: string = core.getInput("AI_PROVIDER") || "openai"; 
const OPENAI_API_MODEL: string = "gpt-4-0125-preview";
const ANTHROPIC_API_MODEL: string = "claude-3-sonnet-20240229";
const COOKBOOK_URL: string = "https://gist.githubusercontent.com/herniqeu/35669801a4bbdc8fa52953986fa61277/raw/24932e0a2422f06eb762802ba0efb1e24d11924f/cookbook.md";

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

interface AIResponse {
  reviews: Review[];
  verdict: {
    status: string;
    details: string[];
    globalIssues?: string[];
  };
  severity?: string;
  analysis?: string;
  suggestion?: string;
  fixPatch?: string;
}

interface Review {
  lineNumber: number;
  issueType: string;
  severity: string;
  problem: string;
  solution: string;
  example: string;
  path: string;
  relatedFiles?: string[];
}

interface DiffPosition {
  path: string;
  position: number; 
  line: number;   
}

interface DiffChange {
  type: 'add' | 'del' | 'normal';
  ln?: number;   
  ln1?: number;  
  ln2?: number;  
  content: string;
}

interface DiffChunk {
  changes: DiffChange[];
  content: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

interface DiffFile {
  to: string | null;
  chunks: DiffChunk[];
}

interface DetailedAnalysis {
  fileIssues: Array<{
    path: string;
    issues: Array<{
      lineNumber: number;
      type: string;
      description: string;
      suggestedFix: string;
      severity: string;
      codeBlock: string;
    }>;
  }>;
  globalIssues: Array<{
    type: string;
    description: string;
    affectedFiles: string[];
  }>;
}

interface ReviewSuggestion {
  path: string;
  lineNumber: number;
  severity: string;
  analysis: string;
  suggestion: string;
  fixPatch?: string;
}

const SKIP_VALIDATION_COMMENT = '// @skip-validation';

async function getPRDetails(): Promise<PRDetails> {
  const { repository, number } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
  );
  const prResponse = await octokit.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });
  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
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

interface BatchPromptConfig {
  files: File[];
  context: string;
  prDetails: PRDetails;
  cookbook: string;
}

async function getAIResponse(prompt: { system: string, user: string }): Promise<AIResponse | null> {
  console.log(`🤖 Sending request to ${AI_PROVIDER.toUpperCase()}`);
  
  try {
    let content: string;
    
    if (AI_PROVIDER === 'anthropic') {
      const response = await anthropic.messages.create({
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
    } else {
      const response = await openai.chat.completions.create({
        model: OPENAI_API_MODEL,
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: "json_object" as const },
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
      content = response.choices[0].message?.content?.trim() || "{}";
    }

    console.log('📥 Raw AI response:', content);

    try {
      const parsed = JSON.parse(content) as AIResponse;
      console.log('✅ Successfully parsed AI response');
      return parsed;
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('📄 Problematic content:', content);
      return null;
    }
  } catch (error) {
    console.error(`❌ ${AI_PROVIDER.toUpperCase()} API error:`, error);
    return null;
  }
}

async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: Array<{ body: string; path: string; line: number }>
): Promise<void> {
  console.log(`${logPrefix.review} Preparing to post ${comments.length} review comments`);

  try {

    const diff = await getDiff(owner, repo, pull_number);
    const parsedDiff = parseDiff(diff);
    
    const diffPositions = new Map<string, DiffPosition[]>();
    
    parsedDiff.forEach(file => {
      const positions: DiffPosition[] = [];
      let position = 0;
      
      file.chunks.forEach(chunk => {
        chunk.changes.forEach(change => {
          position++;
          if (change.type !== 'del') { 
            positions.push({
              path: file.to || '',
              position: position,
              line: 'ln2' in change ? change.ln2! : change.ln!,
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
    }).filter((comment): comment is NonNullable<typeof comment> => comment !== null);

    if (validComments.length === 0) {
      console.log(`${logPrefix.warning} No valid diff positions found for any comments`);
      return;
    }

    console.log(`${logPrefix.review} Posting ${validComments.length} comments (${comments.length - validComments.length} skipped)`);

    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: "COMMENT",
      comments: validComments
    });

    console.log(`${logPrefix.success} Successfully posted review comments`);
  } catch (error) {
    console.error(`${logPrefix.error} Error posting review:`, error);
    
    console.log(`${logPrefix.debug} Attempted to post comments:`, 
      comments.map(c => ({
        path: c.path,
        line: c.line,
        bodyLength: c.body.length
      }))
    );
    
    throw error;
  }
}

async function getDiff(owner: string, repo: string, pull_number: number): Promise<string> {
  
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: {
      format: "diff"
    }
  });

  const diff = response.data as unknown as string;
  
  return diff;
}

async function fetchCookbook(url: string): Promise<string> {
  try {
    if (!url) {
      console.log('ℹNo cookbook URL provided, using default rules');
      return defaultRules;
    }

    console.log(`📥 Fetching cookbook from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch cookbook: ${response.statusText}`);
    }
    const rules = await response.text();
    console.log('✅ Successfully fetched cookbook rules');
    return rules;
  } catch (error) {
    console.error('❌ Error fetching cookbook:', error);
    console.log('⚠️ Falling back to default rules');
    return defaultRules;
  }
}

async function performTwoStepAnalysis(
  parsedDiff: File[],
  prDetails: PRDetails,
  cookbook: string
): Promise<{ reviews: Array<ReviewSuggestion>, hasCriticalIssues: boolean }> {
  const filesToAnalyze = parsedDiff.filter(file => {
    const hasSkipComment = file.chunks.some(chunk => 
      chunk.changes.some(change => 
        change.content.includes(SKIP_VALIDATION_COMMENT)
      )
    );
    if (hasSkipComment) {
      console.log(`🔕 Skipping validation for ${file.to} due to skip comment`);
    }
    return !hasSkipComment;
  });

  if (filesToAnalyze.length === 0) {
    console.log('ℹ️ All files are marked to skip validation');
    return { reviews: [], hasCriticalIssues: false };
  }

  const initialAnalysis = await getComprehensiveAnalysis(filesToAnalyze, prDetails, cookbook);
  const detailedReviews = await generateDetailedReviews(initialAnalysis, cookbook);
  
  const hasCriticalIssues = detailedReviews.some(review => review.severity === 'critical');
  
  return { reviews: detailedReviews, hasCriticalIssues };
}

async function getComprehensiveAnalysis(
  parsedDiff: File[],
  prDetails: PRDetails,
  cookbook: string
): Promise<DetailedAnalysis> {
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

  const response = await getAIResponse({ system: systemPrompt, user: userPrompt });
  if (!response) {
    return { fileIssues: [], globalIssues: [] };
  }
  return response as unknown as DetailedAnalysis;
}

async function generateDetailedReviews(
  analysis: DetailedAnalysis,
  cookbook: string
): Promise<Array<ReviewSuggestion>> {
  const reviews: ReviewSuggestion[] = [];

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

      const response = await getAIResponse(reviewPrompt);
      
      if (!response) continue;
      
      reviews.push({
        path: fileIssue.path,
        lineNumber: issue.lineNumber,
        severity: response.severity ?? 'info',
        analysis: response.analysis ?? 'No analysis',
        suggestion: response.suggestion ?? ''
      });
    }
  }

  return reviews;
}

async function main() {
  console.log('🚀 Starting validation process');
  try {
    const prDetails = await getPRDetails();
    console.log(`📋 Analyzing PR #${prDetails.pull_number} in ${prDetails.owner}/${prDetails.repo}`);
    
    const cookbook = await fetchCookbook(COOKBOOK_URL);
    console.log('✅ Cookbook loaded successfully');

    const diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number
    );

    if (!diff) {
      console.log("❌ No diff found");
      return;
    }
    
    const parsedDiff = parseDiff(diff);
    const { reviews, hasCriticalIssues } = await performTwoStepAnalysis(parsedDiff, prDetails, cookbook);
    
    if (reviews.length > 0) {
      console.log('📤 Posting review comments');
      await createReviewComment(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number,
        reviews.map(review => ({
          body: `${review.analysis}\n\n${
            review.suggestion ? 
            `\`\`\`suggestion
${review.suggestion}
\`\`\`\n` : ''
          }`,
          path: review.path,
          line: review.lineNumber
        }))
      );

      if (hasCriticalIssues) {
        await octokit.pulls.createReview({
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
  } catch (error) {
    console.error('❌ Main process error:', error);
    throw error;
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
