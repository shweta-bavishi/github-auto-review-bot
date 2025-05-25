import express from "express";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import dotenv from "dotenv";
import OpenAI from "openai";
import { App } from "octokit";
import fs from "fs";

dotenv.config();

const PORT = Number(process.env.PORT) || 4000;
const SECRET = process.env.GITHUB_WEBHOOK_SECRET!;
const APP_ID = Number(process.env.GITHUB_APP_ID!);
const PRIVATE_KEY = fs.readFileSync(
  process.env.GITHUB_PRIVATE_KEY_PATH!,
  "utf8"
);
const INSTALLATION_ID = Number(process.env.GITHUB_INSTALLATION_ID!);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// Validate env
if (!SECRET) throw new Error("Missing GITHUB_WEBHOOK_SECRET");
if (!GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!APP_ID) throw new Error("Missing APP_ID");
if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");
if (!INSTALLATION_ID) throw new Error("Missing INSTALLATION_ID");

// Init SDKs
async function main() {
  const webhooks = new Webhooks({ secret: SECRET });
  // const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const appInstance = new App({ appId: APP_ID, privateKey: PRIVATE_KEY });
  const octokit = await appInstance.getInstallationOctokit(INSTALLATION_ID);

  webhooks.on("pull_request.opened", async ({ payload }) => {
    const { body, number, title, html_url } = payload.pull_request;
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;

    // If no description, generate one
    if (!body?.trim()) {
      const prompt = `Provide a concise summary for the following pull request:\n\nTitle: ${title}\n\nURL: ${payload.pull_request.html_url}`;

      try {
        const completion = await openai.completions.create({
          model: "gpt-3.5-turbo-instruct",
          prompt: prompt,
          max_tokens: 150,
          temperature: 0.7,
        });
        const summary = completion.choices[0].text.trim();

        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: number,
          body: `### 📝 PR Summary\n\n${summary}`,
        });
        console.log(`✅ Commented summary on PR #${number}`);

        // …after your existing await octokit.issues.createComment call…

        // 1️⃣ Prepare a prompt to suggest labels
        const listFiles = await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: number,
        });
        const fileList = listFiles.data
          .map((f) => `- ${f.filename}`)
          .join("\n");
        const labelPrompt = `
You are a repo maintainer.  
Title: ${title}  
Description: ${body ?? ""}  
Files changed:
${fileList}

Suggest up to 3 labels (choose from: bug, enhancement, docs, test, refactor, frontend, backend).  
Output a comma-separated list only.
`;

        // 2️⃣ Get GPT’s label suggestions
        const labelsRes = await openai.completions.create({
          model: "gpt-3.5-turbo-instruct",
          prompt: labelPrompt,
          max_tokens: 20,
          temperature: 0,
        });
        const suggestedLabels = labelsRes.choices[0].text
          .trim()
          .toLowerCase()
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean);

        // 3️⃣ Ensure each label exists and apply them
        for (const label of suggestedLabels) {
          try {
            await octokit.rest.issues.addLabels({
              owner,
              repo,
              issue_number: number,
              labels: [label],
            });
          } catch (err: any) {
            if (err.status === 404) {
              // Label doesn't exist yet → create it
              await octokit.rest.issues.createLabel({
                owner,
                repo,
                name: label,
                color: "cfd3d7",
              });
              // Then apply
              await octokit.rest.issues.addLabels({
                owner,
                repo,
                issue_number: number,
                labels: [label],
              });
            }
          }
        }

        // 4️⃣ Map labels → reviewers and request reviews
        const labelToReviewers: Record<string, string[]> = {
          frontend: ["ui-team"],
          backend: ["api-team"],
          bug: ["qa-team"],
          docs: ["doc-reviewer"],
          test: ["qa-team"],
          refactor: ["arch-team"],
          enhancement: ["feature-owner"],
        };
        const reviewers = suggestedLabels
          .flatMap((l) => labelToReviewers[l] || [])
          .filter((v, i, a) => a.indexOf(v) === i);

        if (reviewers.length) {
          await octokit.rest.pulls.requestReviewers({
            owner,
            repo,
            pull_number: number,
            reviewers,
          });
        }
      } catch (err: any) {
        if (err.status === 422 && err.message.includes("not a collaborator")) {
          console.warn(
            "⚠️ One or more reviewers are not collaborators. Skipping."
          );
        } else {
          throw err;
        }
      }
    } else {
      console.log(`ℹ️ PR #${number} already has a description.`);
    }
  });

  webhooks.on("pull_request.synchronize", async ({ payload }) => {
    const pr = payload.pull_request;
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const number = pr.number;
    const sha = pr.head.sha;

    try {
      // 1. Fetch the single latest commit details
      const { data: commit } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha,
      });

      // 2. Extract file-level diffs and filenames
      const filesChanged = commit.files || [];
      if (!filesChanged.length) {
        console.log(`ℹ️ PR #${number} commit ${sha} has no file changes.`);
        return;
      }

      // build absolute paths for each file
      const fileContents = await Promise.all(
        filesChanged.map(async f => {
          const { data } = await octokit.rest.repos.getContent({
            owner, repo, path: f.filename, ref: sha
          });
          const content = Buffer.from((data as any).content, 'base64').toString('utf8');
          return { filename: f.filename, patch: f.patch!, content };
        })
      );
      
      // — Truncate to first 3 files
      const MAX_FILES = 3;
      const MAX_LINES = 20;

      const diffSnippet = filesChanged.slice(0, MAX_FILES).map(f => {
        const lines = f.patch!.split("\n").slice(0, 20).join("\n");
        return `File: ${f.filename}\n${lines}`;
      }).join("\n\n---\n\n");

      const contentSnippet = fileContents.slice(0, MAX_FILES).map(f =>
        `// ${f.filename}\n${f.content.slice(0, 2000)}`
      ).join("\n\n---\n\n");

      // 3. Build a richer prompt
      const prompt = `
      You are a senior software engineer reviewing a pull request. Below is the diff and file contents.
      
      Please:
      - Summarize the intent of the commit in 2–3 bullet points.
      - For each file, suggest improvements or note issues.
      - Highlight bugs, missing functionality, or bad practices.
      - Mention any security, logic, or performance issues.
      
      <<DIFF>>
      ${diffSnippet}
      
      <<FILES>>
      ${contentSnippet}
      
      <<END>>
      `;

      // 4. Ask OpenAI to generate the review comment
      const completion = await openai.completions.create({
        model: "gpt-3.5-turbo-instruct",
        prompt,
        max_tokens: 400,
        temperature: 0.2,
      });
      const reviewComment = completion.choices[0].text.trim();

      // 5. Post as a PR comment
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: number,
        body: `### 🤖 Commit Review (${sha.slice(0, 7)})\n\n${reviewComment}\n\n---\n`,
      });

      // 6️⃣ Create a GitHub Check Run with inline annotations

      await octokit.rest.checks.create({
        owner, repo,
        name: "AI Review",
        head_sha: sha,
        status: "completed",
        conclusion:  "neutral",
        output: {
          title: `Senior Review for PR #${number}`,
          summary: completion.choices[0].text.trim()
        },
      });

      console.log(`✅ Posted review for PR #${number} @ ${sha}`);
    } catch (err) {
      console.error(`❌ Error reviewing commit ${sha} on PR #${number}:`, err);
    }
  });

  webhooks.on("issue_comment.created", async ({ payload }) => {
    const comment = payload.comment.body.trim();
    const issue = payload.issue;
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;

    // Only respond on pull requests
    if (!issue.pull_request) return;
    const prNumber = issue.number;

    try {
      if (comment.startsWith("/summarize")) {
        // Re-run PR summary logic
        // You can factor out your summary code into a helper and call it here
        console.log(`🔄 Slash: summarize PR #${prNumber}`);
        // await summarizePullRequest(owner, repo, prNumber);
      } else if (comment.startsWith("/review")) {
        // Re-run commit review logic
        console.log(`🔄 Slash: review latest commit for PR #${prNumber}`);
        // await reviewLatestCommit(owner, repo, prNumber);
      } else if (comment.startsWith("/labels")) {
        // Add labels from command, e.g. `/labels bug enhancement`
        const labels = comment.replace("/labels", "").trim().split(/\s+/);
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: prNumber,
          labels,
        });
        console.log(
          `✅ Slash: added labels ${labels.join(", ")} to PR #${prNumber}`
        );
      } else if (comment.startsWith("/assign")) {
        // Assign reviewers: `/assign alice bob`
        const reviewers = comment.replace("/assign", "").trim().split(/\s+/);
        await octokit.rest.pulls.requestReviewers({
          owner,
          repo,
          pull_number: prNumber,
          reviewers,
        });
        console.log(
          `✅ Slash: requested reviewers ${reviewers.join(", ")} on PR #${prNumber}`
        );
      }
    } catch (err) {
      console.error("❌ Slash command error:", err);
    }
  });

  const app = express();

  app.use((req, _res, next) => {
    console.log(`→ ${req.method} ${req.url}`);
    next();
  });

  app.use(createNodeMiddleware(webhooks, { path: "/" }));

  app.listen(PORT, () => {
    console.log(`🚀 Server listening at http://localhost:${PORT}/`);
  });
}

main();
