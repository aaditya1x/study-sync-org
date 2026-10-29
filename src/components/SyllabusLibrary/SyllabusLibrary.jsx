import { ExternalLink, GraduationCap, Search } from "lucide-react";
import styles from "./SyllabusLibrary.module.css";

const OFFICIAL_SYLLABUS_INDEX = "https://www.dcrustm.ac.in/syllabus";

const syllabi = [
  {
    id: "dcrust-index",
    programme: "All programmes",
    title: "DCRUST official syllabus index",
    detail: "Browse undergraduate, postgraduate, architecture, education, and older scheme documents. Confirm your admission year and scheme before studying.",
    url: OFFICIAL_SYLLABUS_INDEX,
    source: "DCRUST official website",
    year: "Updated index",
  },
  {
    id: "btech-cse-2026",
    programme: "B.Tech · Computer Science & Engineering",
    title: "Scheme and syllabus · Semesters I–VI",
    detail: "DCRUST CSE scheme and syllabus listed for September 2026.",
    url: "https://www.dcrustm.ac.in/uploads/files/File2026092889982.pdf",
    source: "DCRUST official website",
    year: "2026",
  },
  {
    id: "bca-nep",
    programme: "BCA",
    title: "Complete syllabus and scheme · NEP-2020",
    detail: "Complete BCA syllabus and scheme listed on the DCRUST official syllabus index.",
    url: "https://www.dcrustm.ac.in/uploads/files/File2026092486706.pdf",
    source: "DCRUST official website",
    year: "NEP-2020",
  },
];

export default function SyllabusLibrary({ query = "" }) {
  const search = query.trim().toLowerCase();
  const visibleSyllabi = syllabi.filter((item) =>
    `${item.programme} ${item.title} ${item.detail} ${item.year}`
      .toLowerCase()
      .includes(search)
  );

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <div className={styles.icon} aria-hidden="true"><GraduationCap size={24} /></div>
        <div>
          <p className={styles.eyebrow}>DCRUST · MURTHAL</p>
          <h1>Syllabus Library</h1>
          <p>Find official programme schemes and syllabi in one place.</p>
        </div>
      </header>

      <div className={styles.notice}>
        These links open documents hosted by DCRUST. The official index contains more programmes and schemes; check that a document matches your batch before relying on it.
      </div>

      <div className={styles.grid}>
        {visibleSyllabi.map((item) => (
          <article className={styles.card} key={item.id}>
            <div className={styles.cardTop}>
              <span>{item.programme}</span>
              <span className={styles.year}>{item.year}</span>
            </div>
            <h2>{item.title}</h2>
            <p>{item.detail}</p>
            <small>{item.source}</small>
            <a href={item.url} target="_blank" rel="noreferrer">
              Open syllabus <ExternalLink size={15} />
            </a>
          </article>
        ))}
      </div>

      {!visibleSyllabi.length && (
        <div className={styles.empty}>
          <Search size={20} />
          <p>No syllabus links match “{query}”. Try a programme name or open the full official index.</p>
          <a href={OFFICIAL_SYLLABUS_INDEX} target="_blank" rel="noreferrer">Browse DCRUST syllabus index</a>
        </div>
      )}
    </section>
  );
}
