import { useEffect } from "react";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  ChartNoAxesCombined,
  CheckSquare,
  FileText,
  GraduationCap,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import styles from "./PublicSite.module.css";

function Brand() {
  return <a className={styles.brand} href="/" aria-label="Study Sync home"><span><GraduationCap size={21} /></span>Study Sync</a>;
}

function Footer() {
  return <footer className={styles.footer}><div><Brand /><p>An educational platform for students.</p></div><nav aria-label="Legal"><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/login">Sign in</a></nav><small>© {new Date().getFullYear()} Study Sync</small></footer>;
}

export function PublicLanding() {
  useEffect(() => { document.title = "Study Sync | Your student learning workspace"; }, []);
  const features = [
    { icon: BookOpen, title: "Organize your courses", text: "Keep subjects, chapters and course resources together in one place." },
    { icon: FileText, title: "Keep study materials close", text: "Store notes and files, preview documents and share materials with other signed-in students." },
    { icon: CheckSquare, title: "Stay on top of work", text: "Track assignments, set due dates and see what is complete or still needs attention." },
    { icon: BrainCircuit, title: "Study with AI tools", text: "Turn notes into summaries, explanations and practice questions when you choose to use AI tools." },
    { icon: ChartNoAxesCombined, title: "See your progress", text: "Review study activity and completed work across your learning space." },
    { icon: ShieldCheck, title: "Your own learning space", text: "Sign in to access your workspace and manage your academic profile." },
  ];

  return <div className={styles.site}>
    <header className={styles.header}><div className={styles.headerInner}><Brand /><nav aria-label="Main navigation"><a href="#features">Features</a><a href="#how-it-works">How it works</a></nav><div className={styles.headerActions}><a className={styles.signIn} href="/login">Sign in</a><a className={styles.smallCta} href="/signup">Create account <ArrowRight size={15} /></a></div></div></header>
    <main>
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}><span className={styles.eyebrow}><GraduationCap size={16} /> AN EDUCATIONAL PLATFORM FOR STUDENTS</span><h1>Make space for<br /><em>better learning.</em></h1><p>Study Sync brings your courses, study materials, assignments and progress into one clear workspace—so you can spend less time organizing and more time learning.</p><div className={styles.heroActions}><a className={styles.primaryCta} href="/signup">Get started <ArrowRight size={17} /></a><a className={styles.secondaryCta} href="#features">Explore the platform</a></div><div className={styles.heroNote}><ShieldCheck size={15} /> A student workspace with account-based access</div></div>
          <div className={styles.preview} aria-label="Illustration of a student workspace">
            <div className={styles.previewTop}><div><span className={styles.previewDot} /><span className={styles.previewDot} /><span className={styles.previewDot} /></div><small>MY LEARNING SPACE</small><span className={styles.previewAvatar}>S</span></div>
            <div className={styles.previewBody}><div className={styles.previewGreeting}><div><small>YOUR CAMPUS. YOUR FUTURE.</small><h2>A little progress<br />adds up.</h2></div><span className={styles.previewCap}><GraduationCap size={22} /></span></div>
              <div className={styles.previewStats}><div><BookOpen size={15} /><strong>Courses</strong><span>Organized</span></div><div><CheckSquare size={15} /><strong>Assignments</strong><span>On track</span></div><div><ChartNoAxesCombined size={15} /><strong>Progress</strong><span>In view</span></div></div>
              <div className={styles.previewCourse}><div className={styles.courseIcon}><Layers3 size={17} /></div><div><small>YOUR COURSE LIBRARY</small><strong>Learn one step at a time</strong><span>Subjects · Chapters · Materials</span></div><ArrowRight size={16} /></div>
              <div className={styles.previewTask}><span className={styles.taskCheck}><CheckSquare size={15} /></span><span><strong>Plan your next study session</strong><small>Assignments and goals in one place</small></span><span className={styles.taskBadge}>STUDY</span></div>
            </div>
            <div className={styles.previewFoot}><span><span className={styles.statusDot} /> YOUR STUDY SPACE</span><span>COURSES · NOTES · PROGRESS</span></div>
          </div>
        </div>
        <div className={styles.heroBottom}><span>BUILT AROUND YOUR STUDY ROUTINE</span><div><span><BookOpen size={15}/> Courses</span><span><FileText size={15}/> Materials</span><span><CheckSquare size={15}/> Assignments</span><span><ChartNoAxesCombined size={15}/> Progress</span></div></div>
      </section>
      <section className={styles.features} id="features"><div className={styles.sectionHeading}><span className={styles.sectionEyebrow}>ONE SPACE FOR YOUR STUDIES</span><h2>Everything you need to stay organized.</h2><p>Study Sync is designed for college and university students who want a simpler way to manage everyday study work.</p></div><div className={styles.featureGrid}>{features.map(({ icon: Icon, title, text }, index) => <article className={styles.featureCard} key={title}><span className={styles.featureIcon}><Icon size={20} /></span><small>0{index + 1}</small><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className={styles.how} id="how-it-works"><div className={styles.howInner}><div><span className={styles.sectionEyebrow}>A CLEARER STUDY ROUTINE</span><h2>Bring your learning together.</h2><p>Create an account, set up your academic profile and build a workspace around your courses. Return whenever you need to find a file, plan an assignment or review your progress.</p><a className={styles.primaryCta} href="/signup">Create your account <ArrowRight size={17} /></a></div><div className={styles.steps}><article><span>01</span><div><h3>Set up your space</h3><p>Add your academic details and organize the courses you are taking.</p></div></article><article><span>02</span><div><h3>Collect your study work</h3><p>Keep course materials, notes and assignments together.</p></div></article><article><span>03</span><div><h3>Keep moving forward</h3><p>Use study tools and progress views to support your learning routine.</p></div></article></div></div></section>
      <section className={styles.closing}><GraduationCap size={25} /><h2>Your learning deserves a space of its own.</h2><p>Start organizing your student workspace with Study Sync.</p><a className={styles.primaryCta} href="/signup">Get started with Study Sync <ArrowRight size={17} /></a></section>
    </main><Footer />
  </div>;
}

const termsSections = [
  { title: "1. About Study Sync", paragraphs: ["Study Sync is an educational platform for students. It provides tools to organize courses, study materials, assignments and academic progress, with optional AI-powered study features.", "Study Sync is a learning and organization tool. It does not provide accredited instruction, official academic records, professional advice or guaranteed academic outcomes. Verify course, syllabus and AI-generated information with the relevant official sources."] },
  { title: "2. Accounts and access", paragraphs: ["You are responsible for keeping your sign-in credentials secure and for activity carried out through your account. Provide accurate account information and tell the Study Sync operator if you believe your account has been accessed without permission.", "Some features require an account. Google sign-in, email/password authentication and account recovery are handled through the configured authentication provider. Your use of Google sign-in is also subject to Google's terms."] },
  { title: "3. Your materials and sharing", paragraphs: ["You keep responsibility for the notes, files, prompts and other content you submit. You must have the rights and permissions needed to upload or share that content, and must not upload unlawful, harmful or infringing material.", "Materials you mark as shared may be available to other signed-in students using the platform. Check the sharing setting before uploading or sharing content, and do not share private, confidential or personal information without permission."] },
  { title: "4. Acceptable use", paragraphs: ["Use Study Sync lawfully and for learning and organization. Do not attempt to access another person's account or data, disrupt the service, misuse its AI tools, upload malicious files, or use the platform to violate another person's rights or applicable rules.", "The Study Sync operator may limit or suspend access when reasonably necessary to protect users, the service or its data, or to address misuse."] },
  { title: "5. AI study tools", paragraphs: ["AI features are optional study aids. When you use them, your prompt and relevant study material may be processed by the AI provider to generate a response. Do not submit sensitive, confidential or identifying information. AI output may be incomplete or incorrect; review it before relying on it.", "AI features are subject to the provider's terms and eligibility requirements. The Gemini API terms currently require users to be at least 18 and restrict API clients directed to or likely to be accessed by people under 18. Do not use the AI features if you are under 18. The operator should ensure the service and its audience meet the provider's current requirements before making AI features available."] },
  { title: "6. Third-party services and links", paragraphs: ["Study Sync relies on third-party services, including Supabase for authentication and data services, Google services for Google sign-in and optional AI features, and Vercel for hosting. Those providers operate under their own terms and privacy information.", "The platform may link to external educational materials. Those websites and files are operated by others; Study Sync does not control their content or availability."] },
  { title: "7. Availability and changes", paragraphs: ["Features may change or become temporarily unavailable as the service is maintained. The Study Sync operator may update these terms when the service or its requirements change. The updated date below indicates the latest revision."] },
  { title: "8. Contact", paragraphs: ["For questions about these terms, contact the Study Sync operator through the contact channel provided by the person or organization that operates your Study Sync service."] },
];

const privacySections = [
  { title: "1. Information the platform uses", paragraphs: ["Account information: your email address and, when provided, your name and Google account profile details used for sign-in.", "Academic and workspace information: academic profile selections, courses, subjects, assignments, progress, notes, uploaded material, profile photos and sharing settings that you choose to add.", "AI requests: if you choose an AI study feature, your prompt and the relevant notes or excerpts from a selected indexed PDF are sent to the AI service to produce the requested study response.", "Technical information: the hosting and service providers may process request and diagnostic information needed to deliver, secure and troubleshoot the platform."] },
  { title: "2. How information is used", paragraphs: ["Information is used to authenticate you, provide your workspace, store and display your learning materials, support sharing settings, operate account and recovery flows, generate AI study responses when requested, and maintain service security and reliability.", "Study Sync does not need your study materials for advertising. Do not put sensitive or confidential information into notes, uploads or AI prompts."] },
  { title: "3. Storage and service providers", paragraphs: ["Study Sync uses Supabase for authentication, database and file storage; Vercel for hosting; and Google services for Google OAuth and optional Gemini AI requests. Some workspace values are also stored in your browser so your workspace can persist between visits.", "When you use AI tools, your request and relevant study text are sent from the Study Sync server to Google's Gemini API. Google's handling is governed by its current API terms and privacy information. Review the provider links below before submitting material."] },
  { title: "4. Sharing and visibility", paragraphs: ["Study Sync does not make private materials public by default. Materials you choose to mark as shared may be visible to other signed-in students. Information is also processed by the providers that host and operate the platform, and may be disclosed where required to address security, legal or service integrity needs."] },
  { title: "5. Retention and your choices", paragraphs: ["Information is retained as needed to provide the account and features, subject to the platform's storage and backup configuration and applicable requirements. You can manage materials and sharing settings through the features provided in your workspace.", "For questions or requests about accessing, correcting or deleting account information, contact the Study Sync operator through the contact channel provided by the person or organization that operates your service. Some records may need to be retained for security, legal or operational reasons."] },
  { title: "6. Security", paragraphs: ["Study Sync uses account-based access and hosted service providers to operate the platform. No online service can guarantee absolute security. Protect your credentials, sign out on shared devices and avoid uploading information you would not want processed by the platform's providers."] },
  { title: "7. Children and age requirements", paragraphs: ["Study Sync is designed for college and university students. The optional Gemini-powered AI tools have an 18+ eligibility requirement under Google's current Gemini API terms. Do not use those AI tools if you are under 18. The service operator should ensure its audience and use of those tools meet current provider requirements."] },
  { title: "8. Changes and contact", paragraphs: ["This notice may be updated as the service changes. For privacy questions or requests, contact the Study Sync operator through the contact channel provided by the person or organization that operates your Study Sync service."] },
];

export function LegalPage({ type }) {
  const isTerms = type === "terms";
  const title = isTerms ? "Terms of Service" : "Privacy Policy";
  const sections = isTerms ? termsSections : privacySections;
  useEffect(() => { document.title = `${title} | Study Sync`; }, [title]);
  return <div className={styles.site}><header className={styles.header}><div className={styles.headerInner}><Brand /><div className={styles.headerActions}><a className={styles.signIn} href="/">Home</a><a className={styles.smallCta} href="/signup">Create account <ArrowRight size={15} /></a></div></div></header><main className={styles.legalMain}><div className={styles.legalIntro}><span className={styles.sectionEyebrow}>STUDY SYNC · STUDENT LEARNING PLATFORM</span><h1>{title}</h1><p>Clear information about using Study Sync and how the platform handles your information.</p><small>Last updated October 31, 2026</small></div><article className={styles.legalContent}>{sections.map(({ title: sectionTitle, paragraphs }) => <section key={sectionTitle}><h2>{sectionTitle}</h2>{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}{!isTerms && <section><h2>Provider information</h2><p><a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">Supabase Privacy Policy</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a> · <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini API Additional Terms</a></p></section>}</article></main><Footer /></div>;
}
