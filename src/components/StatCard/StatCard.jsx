import styles from "./StatCard.module.css";
export default function StatCard({ label, value, note, icon: Icon, tint="purple", onClick }) {
  const content = <><div className={styles.top}><span>{label}</span><span className={`${styles.icon} ${styles[tint]}`}><Icon size={18}/></span></div><strong className={styles.value}>{value}</strong><p>{note}</p></>;
  return onClick
    ? <button type="button" className={`${styles.card} ${styles.interactive}`} onClick={onClick} aria-label={`${label}: ${value}. ${note}`}>
        {content}
      </button>
    : <article className={styles.card}>{content}</article>;
}
