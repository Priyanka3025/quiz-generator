# 🎓 AI Quiz Generator - Vercel Deployment (FREE)

## 📋 What's in this folder

```
quiz-app-vercel/
├── index.html                # Frontend (UI)
├── vercel.json               # Vercel config
├── package.json              # Project metadata
└── api/
    └── generate-quiz.js      # Backend (Google Gemini API)
```

## 💰 Cost: $0 (Completely Free!)

- ✅ Vercel hosting: **Free forever** (100GB bandwidth/month)
- ✅ Vercel Serverless Functions: **Free** (100GB-hours/month)
- ✅ Google Gemini API: **Free tier** (250 quizzes/day)
- ✅ No credit card required anywhere

---

## 📥 Export Formats Supported

CSV, Excel (.xlsx), Word (.docx), JSON, Print - all with standardized columns:

`Question | Option_A | Option_B | Option_C | Option_D | Answer | Answer_Key | Solution | Difficulty_Level | Bloom_Taxonomy_Level`

---

## 🚀 Deployment Steps (10 minutes total)

### **Step 1: Get Your FREE Gemini API Key** (3 min)

1. Go to 👉 **https://aistudio.google.com/**
2. Sign in with your **Google account**
3. Click **"Get API key"** in the left sidebar
4. Click **"Create API key"** → **"Create API key in new project"**
5. **COPY THE KEY** (starts with `AIza...`)
6. Save it somewhere safe

> ✅ **No credit card needed!**

---

### **Step 2: Deploy to Vercel** (5 min)

Vercel has **two easy methods**. Pick whichever you prefer:

#### 🎯 Method A: Drag & Drop via Vercel Dashboard (Easiest)

1. Go to **https://vercel.com/signup**
2. Sign up with **GitHub, GitLab, or Email** (free)
3. After login, click **"Add New..."** → **"Project"**
4. Scroll down and find **"Clone Template"** section
5. **OR** just go to: **https://vercel.com/new**
6. You'll see an **"Import Git Repository"** section — skip that
7. At the bottom, look for **"Deploy"** without git

**If drag-drop isn't visible, use Method B (recommended):**

#### 🎯 Method B: Via Vercel CLI (Super Fast - Recommended)

This takes only 2 minutes and is very reliable.

**On Windows / Mac / Linux:**

1. Make sure you have **Node.js installed** (https://nodejs.org — install if needed)
2. Open **Command Prompt** (Windows) or **Terminal** (Mac/Linux)
3. Install Vercel CLI (one-time):
   ```
   npm install -g vercel
   ```
4. Navigate to your unzipped folder:
   ```
   cd path/to/quiz-app-vercel
   ```
   *(Replace with your actual path. On Windows, you can type `cd ` then drag the folder into terminal.)*

5. Deploy:
   ```
   vercel
   ```
6. First time: it'll ask you to **log in** — choose GitHub/Email, follow the prompts
7. It'll ask some questions:
   - **Set up and deploy?** → Press `Y`
   - **Which scope?** → Select your account
   - **Link to existing project?** → `N`
   - **Project name?** → Press Enter (or type `quiz-generator`)
   - **Directory?** → Press Enter (current folder)
   - **Override settings?** → `N`
8. Wait ~30 seconds... Done! 🎉
9. You'll get a URL like `https://quiz-generator-xyz.vercel.app`

---

### **Step 3: Add Gemini API Key to Vercel** (2 min) ⚠️ CRITICAL

#### Via Dashboard:

1. Go to **https://vercel.com/dashboard**
2. Click on your project (e.g., `quiz-generator`)
3. Click **"Settings"** tab (top menu)
4. Click **"Environment Variables"** in the left sidebar
5. Add new variable:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** Your `AIza...` key from Step 1
   - **Environment:** Check all 3 (Production, Preview, Development)
6. Click **"Save"**

---

### **Step 4: Redeploy** (1 min)

Vercel needs to restart to pick up the new environment variable.

#### Via Dashboard:
1. Go to **"Deployments"** tab in your project
2. Click the **"..."** (three dots) on the latest deployment
3. Click **"Redeploy"**
4. Confirm — wait ~30 seconds

#### Or via CLI:
```
vercel --prod
```

---

### **Step 5: Test It!** (2 min)

1. Visit your Vercel URL (`https://quiz-generator-xyz.vercel.app`)
2. Test it:
   - Select **"Select Chapter/Topic"**
   - Type: `Photosynthesis basics Class 10`
   - Number of Questions: **3**
3. Click **"🚀 Generate Quiz"**
4. Wait 10-20 seconds
5. Questions should appear! 🎉

---

## 🎨 Optional: Custom Domain / Project Name

1. Go to **Project Settings** → **Domains**
2. Add a custom name: `my-quiz.vercel.app` (free)
3. Or add your own domain (free - just configure DNS)

---

## 🐛 Troubleshooting

### ❌ "GEMINI_API_KEY not configured"
- You forgot Step 3 or Step 4. Add the env variable and redeploy.

### ❌ "Invalid API key"
- Check for extra spaces or typos. Create a fresh key if needed.

### ❌ "Rate limit reached"
- You've hit 10 requests/minute or 250/day. Wait and retry.

### ❌ Function timeout
- PDF is too large (keep under 5MB)
- Reduce number of questions

### ❌ Deployment failed
- Check the build logs in Vercel dashboard
- Make sure all 4 files are in correct structure

### 📋 Check Function Logs
- Vercel Dashboard → Your Project → **Logs** tab
- Filter by "Functions" to see API errors

---

## ⚡ Vercel vs Netlify — Why Vercel Rocks

| Feature | Vercel | Netlify |
|---------|--------|---------|
| Function timeout (free) | **60 seconds** ✅ | 10 seconds ⚠️ |
| Deploy speed | ⚡ Super fast | Fast |
| CLI experience | ⭐ Excellent | Good |
| Free function invocations | Unlimited | 125k/month |
| Dashboard UX | ⭐ Cleaner | Good |

**Key advantage:** Vercel's 60-second function timeout is **6x longer** than Netlify's free tier — better for larger PDFs and more questions.

---

## 📤 Sharing with Friends/Students

Just share your Vercel URL: `https://your-project.vercel.app`

Done! No setup needed on their end.

---

## 🎯 Quick Reference Links

- **Google AI Studio:** https://aistudio.google.com/
- **Vercel Dashboard:** https://vercel.com/dashboard
- **Vercel CLI Docs:** https://vercel.com/docs/cli

---

## 🚀 Pro Tips

1. **Use Vercel CLI** — After first setup, you can redeploy in 2 seconds with just `vercel --prod`
2. **Preview deployments** — Every change creates a unique preview URL for testing
3. **Analytics** — Vercel offers free analytics — enable in project settings
4. **Vercel tightly integrates with GitHub** — If you put your code on GitHub, every push auto-deploys!

Good luck! 🎉
