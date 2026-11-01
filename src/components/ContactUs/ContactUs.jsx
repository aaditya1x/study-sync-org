import { useState } from "react";
import { AtSign, CheckCircle2, GraduationCap, Mail, Phone, Send, ShieldCheck } from "lucide-react";
import styles from "./ContactUs.module.css";

const initial = { name: "", email: "", subject: "", message: "", website: "" };

export default function ContactUs() {
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  function update(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }
  function submit(event) {
    event.preventDefault();
    setStatus({ state: "success", message: "O bhai! 😂 Call kar le mere pe, bagal mein hi number hai. Message karne ke paise lagte hain! 😭" });
  }
  return <section className={styles.page}>
    <header className={styles.heading}><span><Mail size={22}/></span><div><p>WE’RE HERE TO HELP</p><h1>Contact Us</h1><small>Choose an appropriate contact or send the team a message.</small></div></header>
    <div className={styles.grid}>
      <div className={styles.contacts}>
        <article className={`${styles.card} ${styles.primary}`}>
          <span className={styles.cardIcon}><GraduationCap size={21}/></span><p className={styles.eyebrow}>PRIMARY ACADEMIC CONTACT</p>
          <h2>Komal Mam</h2><strong>Primary Academic Contact</strong>
          <p>Contact Komal Mam for academic guidance, syllabus queries, mock tests and other student-related questions.</p>
          <div className={styles.unavailable}><ShieldCheck size={15}/> Direct contact actions will appear when verified details are available.</div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardIcon}><AtSign size={20}/></span><p className={styles.eyebrow}>WEBSITE SUPPORT</p>
          <h2>Aaditya Kumar</h2><strong>Website Administrator</strong>
          <p>93044 59942 · aaditya002@yahoo.com</p>
          <div className={styles.actions}><a href="tel:9304459942"><Phone size={15}/> Call Admin</a><a href="mailto:aaditya002@yahoo.com"><Mail size={15}/> Email Admin</a></div>
          <small>Use the form for website or account issues.</small>
        </article>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <div><p className={styles.eyebrow}>SEND A MESSAGE</p><h2>How can we help?</h2><p>Your message is securely submitted to the support inbox.</p></div>
        <label>Name<input name="name" value={form.name} onChange={update} autoComplete="name" required minLength={2} maxLength={100}/></label>
        <label>Email<input type="email" name="email" value={form.email} onChange={update} autoComplete="email" required maxLength={254}/></label>
        <label>Subject<input name="subject" value={form.subject} onChange={update} required minLength={3} maxLength={160}/></label>
        <label>Message<textarea name="message" value={form.message} onChange={update} required minLength={10} maxLength={5000} rows={5}/></label>
        <label className={styles.honeypot} aria-hidden="true" tabIndex={-1}>Leave this field empty<input name="website" value={form.website} onChange={update} tabIndex={-1} autoComplete="off"/></label>
        <button type="submit">Submit Message<Send size={15}/></button>
        {status.message && <p className={status.state === "success" ? styles.success : styles.error} role={status.state === "success" ? "status" : "alert"}>{status.state === "success" && <CheckCircle2 size={16}/>} {status.message}</p>}
      </form>
    </div>
  </section>;
}
