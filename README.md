# AI-Powered GitHub PR Auto-Review Bot

Automatically summarizes, annotates, labels, and requests reviewers on your GitHub pull requests using OpenAI and the GitHub Apps API.

---

## 🚀 Features

- **PR Summaries**  
  Generates a concise, 2–3 bullet summary whenever a PR is opened.
- **Commit-Level Review**  
  On each push to a PR, analyzes the latest commit diff + file contents.
- **Senior-Level Feedback**  
  As a “senior engineer,” points out bugs, missing functionality, performance or security issues.
- **Labels & Reviewers**  
  Suggests and applies labels; requests the right team or users.
- **Checks & Inline Annotations**  
  Posts a GitHub Check Run with full feedback in a scrollable “Details” panel.
- **Slash-Commands**  
  `/summarize`, `/review`, `/labels`, `/assign` to manually trigger flows.

---

## 📺 Live Demo

1. **Open a PR** → see auto-generated PR summary.  
2. **Push a commit** → see AI Review Check Run with detailed feedback.  
3. **Push a changee** → bot auto-comments with summary on the changes made
4. **Add `/review`** → re-run the review on demand.  

---

## 🛠️ Prerequisites

- **Node.js** ≥ 18  
- **npm** or **yarn**  
- A public HTTPS URL for webhooks (e.g. via [ngrok](https://ngrok.com/))  
- A GitHub **App** with:  
  - **Permissions**  
    - Issues → Read & Write  
    - Pull requests → Read & Write  
    - Checks → Read & Write  
  - **Webhook Events**  
    - `pull_request`  
    - `issue_comment`  
- Installed the GitHub App on each target repository

---

## ⚙️ Environment Variables

Create a `.env` file in the project root with the following:

```ini
# Server configuration
PORT=4000

# GitHub webhook
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# GitHub App credentials
GITHUB_APP_ID=123456                # Your App's numeric ID
GITHUB_INSTALLATION_ID=7890123      # The installation ID for your target repo
GITHUB_PRIVATE_KEY_PATH=./app.pem   # Path to your downloaded PEM key

# (Optional) Legacy PAT if needed
GITHUB_TOKEN=ghp_xxx

# OpenAI API
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
```

---

## 🔧 Setup & Installation

1. Clone the repository
```git clone https://github.com/shweta-bavishi/github-auto-review-bot.git
cd github-auto-review-bot
```

2. Install dependencies
``` npm install
# or
yarn install
 ```

3. Generate your GitHub App private key
- In your GitHub App settings → Private keys → Generate a key
- Save the downloaded app.pem to the path you configured in GITHUB_PRIVATE_KEY_PATH.
  
4. Expose your local server
```ngrok http 4000 ```
Copy the HTTPS URL (e.g. https://abcd1234.ngrok.io) to your GitHub App’s Webhook → Payload URL.

---

## ▶️ Running Locally

```
npm run dev
# or
yarn dev
```
You should see in your console:
```
→ POST /
🔔 Received pull_request event…
🚀 Server listening at http://localhost:4000/
```

---

## 🔗 Installing the GitHub App
Visit your App’s install page:
https://github.com/apps/PR-Auto-Review-Bot/installations/new

Select Only select repositories → check the repo(s) you want to enable

Click Install or Update installation

---

## 🔍 How It Works
1. Webhook Receiver
GitHub sends events (pull_request.opened, pull_request.synchronize, issue_comment.created) to your Express server.

2. PR Opened
If the PR description is empty (or always), the bot:
  - Fetches the head commit diff + file contents
  - Prompts OpenAI for a summary + senior-level feedback
  - Posts a “📝 PR Summary” and detailed “🤖 PR Change Summary” comment.

3. Commit Synchronize
On every push, the bot:
  - Fetches the latest commit diff + content
  - Prompts OpenAI for file-by-file improvement points
  - Posts a GitHub Check Run with summary (first 3 bullets) + full text feedback.

4. Labels & Reviewers
Based on changed files, the bot asks OpenAI for up to 3 labels, applies/creates them, and requests reviewers.

5. Slash-Commands
Users can comment /summarize, /review, /labels bug enhancement, or /assign alice bob to trigger flows manually.

---

## ❓ Troubleshooting

- 403 “Resource not accessible by integration”
  → Re-install your GitHub App after granting Pull requests: Read & Write and Issues: Read & Write in App settings.

- No issue_comment events
  → Ensure Issue comment is checked under Webhook events and reinstall the App.

- OpenAI token or rate-limit errors
  → Reduce MAX_FILES/MAX_LINES in index.ts, or upgrade your OpenAI plan.

--- 

## 🤝 Contributing

Contributions welcome!

  1. Fork the repo
  2. Create a branch (git checkout -b feature/xyz)
  3. Implement your changes
  4. Open a pull request

---

## 📄 License

MIT © Shweta Bavishi
