import { ChevronLeft, ChevronRight, GraduationCap, X } from "lucide-react";
import styles from "./Sidebar.module.css";

export default function Sidebar({ items, active, onChange, mobileOpen = false, onClose, collapsed = false, onToggleCollapse }) {
  const groups = [...new Set(items.map((item) => item.group || "Workspace"))];
  return <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""} ${collapsed ? styles.collapsed : ""}`} aria-label="Main navigation">
    <div className={styles.brand}>
      <span className={styles.logo}><GraduationCap size={21}/></span>{!collapsed && <span>Study Sync</span>}
      <button type="button" className={styles.collapse} onClick={onToggleCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight size={17}/> : <ChevronLeft size={17}/>}</button>
      <button type="button" className={styles.close} aria-label="Close navigation" onClick={onClose}><X size={18}/></button>
    </div>
    <nav className={styles.nav}>{groups.map((group) => <section className={styles.group} key={group}>
      {!collapsed && <p className={styles.label}>{group}</p>}
      {items.filter((item) => (item.group || "Workspace") === group).map(({ id, label, icon: Icon }) =>
        <button type="button" key={id} title={collapsed ? label : undefined} onClick={() => onChange(id)} className={`${styles.navItem} ${active === id ? styles.active : ""}`} aria-current={active === id ? "page" : undefined}>
          <Icon size={18}/>{!collapsed && <span>{label}</span>}
        </button>
      )}
    </section>)}</nav>
  </aside>;
}
