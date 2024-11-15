import type { LanguageModelV1 } from 'ai'
import type { Result } from 'neverthrow'
import type { File } from 'parse-diff'
import { readFileSync } from 'node:fs'
import * as core from '@actions/core'
import anthropic from '@ai-sdk/anthropic'
import openai from '@ai-sdk/openai'
import { Octokit } from '@octokit/rest'
import { generateText } from 'ai'
import dedent from 'dedent'
import { err, ok, ResultAsync } from 'neverthrow'
import parseDiff from 'parse-diff'

const GITHUB_TOKEN: string = core.getInput('GITHUB_TOKEN')
const OPENAI_API_KEY: string = core.getInput('OPENAI_API_KEY')
const ANTHROPIC_API_KEY: string = core.getInput('ANTHROPIC_API_KEY')
const AI_PROVIDER: string = core.getInput('AI_PROVIDER') || 'openai'
const COOKBOOK_URL: string = 'https://gist.githubusercontent.com/herniqeu/35669801a4bbdc8fa52953986fa61277/raw/24932e0a2422f06eb762802ba0efb1e24d11924f/cookbook.md'

const octokit = new Octokit({ auth: GITHUB_TOKEN })

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

const SKIP_VALIDATION_COMMENT = '// @skip-validation'

const logger = {
    info: (message: string, ...args: any[]) => {
        // eslint-disable-next-line no-console
        console.log(`🔍 ${message}`, ...args)
        core.info(message)
    },
    warn: (message: string, ...args: any[]) => {
        // eslint-disable-next-line no-console
        console.log(`⚠️ ${message}`, ...args)
        core.warning(message)
    },
    error: (message: string, ...args: any[]) => {
        console.error(`❌ ${message}`, ...args)
        core.error(message)
    },
    debug: (message: string, ...args: any[]) => {
        // eslint-disable-next-line no-console
        console.log(`🐛 ${message}`, ...args)
        core.debug(message)
    },
    success: (message: string, ...args: any[]) => {
        // eslint-disable-next-line no-console
        console.log(`✅ ${message}`, ...args)
        core.info(message)
    },
    review: (message: string, ...args: any[]) => {
        // eslint-disable-next-line no-console
        console.log(`📝 ${message}`, ...args)
        core.info(message)
    },
}

async function getPRDetails(): Promise<PRDetails> {
    const { repository, number } = JSON.parse(
        readFileSync(process.env.GITHUB_EVENT_PATH || '', 'utf8'),
    )
    const prResponse = await octokit.pulls.get({
        owner: repository.owner.login,
        repo: repository.name,
        pull_number: number,
    })
    return {
        owner: repository.owner.login,
        repo: repository.name,
        pull_number: number,
        title: prResponse.data.title ?? '',
        description: prResponse.data.body ?? '',
    }
}

const defaultRules = `Review the Pull Request and provide a verdict on whether it should be approved, requires changes, or is blocked.`

function resolveModel() {
    const modelPerProvider = {
        openai: openai.createOpenAI({ apiKey: OPENAI_API_KEY })('gpt-4o'),
        anthropic: anthropic.createAnthropic({ apiKey: ANTHROPIC_API_KEY })('claude-3-5-sonnet-20241022'),
    } as Record<string, LanguageModelV1>

    return modelPerProvider[AI_PROVIDER] ?? modelPerProvider.openai
}

async function getAIResponse(prompt: { system: string, user: string }): Promise<Result<AIResponse, Error>> {
    logger.info(`Sending request to ${AI_PROVIDER.toUpperCase()}`)

    const response = await ResultAsync.fromPromise(
        generateText({
            model: resolveModel(),
            system: prompt.system,
            prompt: prompt.user,
        }),
        (error) => {
            logger.error(`${AI_PROVIDER.toUpperCase()} API error: ${error}`)
            return error as Error
        },
    )

    if (response.isErr()) {
        logger.error(`Failed to generate text: ${response.error}`)
        return err(response.error)
    }

    const content = response.value.text
    logger.debug('Raw AI response:', content)

    const parsed = safeParseJSON<AIResponse>(content)

    if (parsed.isErr()) {
        logger.error('Failed to parse AI response:', parsed.error)
        return err(parsed.error)
    }

    return ok(parsed.value)
}

async function createReviewComment(
    owner: string,
    repo: string,
    pull_number: number,
    comments: Array<{ body: string; path: string; line: number }>,
): Promise<Result<void, Error>> {
    logger.review(`Preparing to post ${comments.length} review comments`)

    try {
        const diff = await getDiff(owner, repo, pull_number)

        if (diff.isErr()) {
            logger.error('Failed to fetch diff:', diff.error)
            return err(diff.error)
        }

        const parsedDiff = parseDiff(diff.value)

        const diffPositions = new Map<string, DiffPosition[]>()

        parsedDiff.forEach((file) => {
            const positions: DiffPosition[] = []
            let position = 0

            file.chunks.forEach((chunk) => {
                chunk.changes.forEach((change) => {
                    position++
                    if (change.type !== 'del') {
                        positions.push({
                            path: file.to || '',
                            position,
                            line: 'ln2' in change ? change.ln2! : change.ln!,
                        })
                    }
                })
            })

            diffPositions.set(file.to || '', positions)
        })

        const validComments = comments.map((comment) => {
            const filePositions = diffPositions.get(comment.path)
            if (!filePositions) {
                logger.warn(`No diff positions found for file: ${comment.path}`)
                return null
            }

            const diffPosition = filePositions.find(pos => pos.line === comment.line)
            if (!diffPosition) {
                logger.warn(`No diff position found for line ${comment.line} in ${comment.path}`)
                return null
            }

            return {
                path: comment.path,
                body: comment.body,
                position: diffPosition.position,
            }
        }).filter((comment): comment is NonNullable<typeof comment> => comment !== null)

        if (validComments.length === 0) {
            logger.warn(`No valid diff positions found for any comments`)
            return ok(undefined)
        }

        logger.review(`Posting ${validComments.length} comments (${comments.length - validComments.length} skipped)`)

        await octokit.pulls.createReview({
            owner,
            repo,
            pull_number,
            event: 'COMMENT',
            comments: validComments,
        })

        logger.success(`Successfully posted review comments`)
        return ok(undefined)
    }
    catch (error) {
        logger.error(`Error posting review:`, error)

        logger.debug(`Attempted to post comments:`, comments.map(c => ({
            path: c.path,
            line: c.line,
            bodyLength: c.body.length,
        })))

        return err(error as Error)
    }
}

async function getDiff(owner: string, repo: string, pull_number: number): Promise<Result<string, Error>> {
    try {
        const response = await octokit.pulls.get({
            owner,
            repo,
            pull_number,
            mediaType: {
                format: 'diff',
            },
        })

        const diff = response.data as unknown as string
        return ok(diff)
    }
    catch (error) {
        logger.error(`Error fetching diff:`, error)
        return err(error as Error)
    }
}

async function fetchCookbook(url: string): Promise<Result<string, Error>> {
    if (!url) {
        logger.info(`No cookbook URL provided, using default rules`)
        return ok(defaultRules)
    }

    logger.info(`Fetching cookbook from: ${url}`)

    try {
        const response = await fetch(url)
        if (!response.ok) {
            return err(new Error(`Failed to fetch cookbook: ${response.statusText}`))
        }
        const rules = await response.text()
        logger.success(`Successfully fetched cookbook rules`)
        return ok(rules)
    }
    catch (error) {
        logger.error(`Error fetching cookbook:`, error)
        logger.warn(`Falling back to default rules`)
        return ok(defaultRules)
    }
}

async function performTwoStepAnalysis(
    parsedDiff: File[],
    prDetails: PRDetails,
    cookbook: string,
): Promise<Result<{ reviews: Array<ReviewSuggestion>, hasCriticalIssues: boolean }, Error>> {
    const filesToAnalyze = parsedDiff.filter((file) => {
        const hasSkipComment = file.chunks.some(chunk =>
            chunk.changes.some(change =>
                change.content.includes(SKIP_VALIDATION_COMMENT),
            ),
        )
        if (hasSkipComment) {
            logger.info(`Skipping validation for ${file.to} due to skip comment`)
        }
        return !hasSkipComment
    })

    if (filesToAnalyze.length === 0) {
        logger.info(`All files are marked to skip validation`)
        return ok({ reviews: [], hasCriticalIssues: false })
    }

    return ResultAsync.fromPromise(
        (async () => {
            const initialAnalysis = await getComprehensiveAnalysis(filesToAnalyze, prDetails, cookbook)
            const detailedReviews = await generateDetailedReviews(initialAnalysis, cookbook)
            const hasCriticalIssues = detailedReviews.some(review => review.severity === 'critical')

            return { reviews: detailedReviews, hasCriticalIssues }
        })(),
        error => error as Error,
    )
}

async function getComprehensiveAnalysis(
    parsedDiff: File[],
    prDetails: PRDetails,
    cookbook: string,
): Promise<DetailedAnalysis> {
    const systemPrompt = dedent`
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
      }`

    const userPrompt = dedent`
      PR Title: ${prDetails.title}
      PR Description: ${prDetails.description}

      Changed Files:
      ${JSON.stringify(parsedDiff, null, 2)}
    `

    const response = await getAIResponse({ system: systemPrompt, user: userPrompt })
    if (response.isErr()) {
        logger.error(`Failed to generate comprehensive analysis:`, response.error)
        return { fileIssues: [], globalIssues: [] }
    }
    return response.value as unknown as DetailedAnalysis
}

async function generateDetailedReviews(
    analysis: DetailedAnalysis,
    cookbook: string,
): Promise<Array<ReviewSuggestion>> {
    const reviews: ReviewSuggestion[] = []

    for (const fileIssue of analysis.fileIssues) {
        for (const issue of fileIssue.issues) {
            const reviewPrompt = {
                system: dedent`
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
                  }
                `,
                user: dedent`
                  Issue Type: ${issue.type}
                  File: ${fileIssue.path}
                  Line: ${issue.lineNumber}
                  Description: ${issue.description}
                  Code: ${issue.codeBlock}
                `,
            }

            const response = await getAIResponse(reviewPrompt)

            if (response.isErr()) {
                logger.error(`Failed to generate detailed review:`, response.error)
                continue
            }

            if (!response.value) {
                continue
            }

            reviews.push({
                path: fileIssue.path,
                lineNumber: issue.lineNumber,
                severity: response.value.severity ?? 'info',
                analysis: response.value.analysis ?? 'No analysis',
                suggestion: response.value.suggestion ?? '',
            })
        }
    }

    return reviews
}

async function main() {
    logger.info(`Starting validation process`)
    try {
        const prDetails = await getPRDetails()
        logger.info(`Analyzing PR #${prDetails.pull_number} in ${prDetails.owner}/${prDetails.repo}`)

        const cookbook = await fetchCookbook(COOKBOOK_URL)

        if (cookbook.isErr()) {
            logger.error(`Failed to fetch cookbook:`, cookbook.error)
            return
        }

        logger.success(`Cookbook loaded successfully`)

        const diff = await getDiff(
            prDetails.owner,
            prDetails.repo,
            prDetails.pull_number,
        )

        if (diff.isErr()) {
            logger.error(`Failed to fetch diff:`, diff.error)
            return
        }

        const parsedDiff = parseDiff(diff.value)
        const analysis = await performTwoStepAnalysis(parsedDiff, prDetails, cookbook.value)

        if (analysis.isErr()) {
            logger.error(`Failed to perform two-step analysis:`, analysis.error)
            return
        }

        if (analysis.value.reviews.length > 0) {
            logger.info(`Posting review comments`)
            await createReviewComment(
                prDetails.owner,
                prDetails.repo,
                prDetails.pull_number,
                analysis.value.reviews.map(review => ({
                    body: dedent`
                      ${review.analysis}
                      
                      ${review.suggestion
                        ? dedent`
                                  \`\`\`suggestion
                                  ${review.suggestion}
                                  \`\`\`\n
                                `
                        : ''}`,
                    path: review.path,
                    line: review.lineNumber,
                })),
            )

            if (analysis.value.hasCriticalIssues) {
                await octokit.pulls.createReview({
                    owner: prDetails.owner,
                    repo: prDetails.repo,
                    pull_number: prDetails.pull_number,
                    event: 'REQUEST_CHANGES',
                    body: 'Changes requested based on critical issues found in review.',
                })
                core.setFailed(`Critical issues found in the PR`)
            }

            logger.success(`Review comments posted successfully`)
        }
    }
    catch (error) {
        logger.error(`Main process error:`, error)
        throw error
    }
}

main().catch((error) => {
    logger.error(`Error:`, error)
    process.exit(1)
})

function safeParseJSON<T>(content: string): Result<T, Error> {
    try {
        return ok(JSON.parse(content) as T)
    }
    catch (error) {
        return err(error as Error)
    }
}
