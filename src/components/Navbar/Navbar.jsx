import { useEffect, useRef, useState } from "react";
import { Menu, Search, UserRound, LogOut, X } from "lucide-react";
import styles from "./Navbar.module.css";

export default function Navbar({
  title, query, onQueryChange, searchResults = [], onSelectSearchResult,
  onMenu, mobileNavOpen = false, profilePicture = "", onOpenSettings,
  username = "Student", onLogout,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const closeOnOutside = (event) => {
      if (!searchRef.current?.contains(event.target)) setSearchOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [searchOpen]);

  function handleSearchKeyDown(event) {
    if (event.key === "Escape") {
      setSearchOpen(false);
      return;
    }
    if (!searchResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSelectSearchResult?.(searchResults[activeIndex] || searchResults[0]);
      setSearchOpen(false);
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button type="button" className={styles.menu} onClick={onMenu} aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen}>
          {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <div className={styles.breadcrumb}><span className={styles.workspaceLabel}>Workspace</span><span className={styles.separator}>/</span><strong>{title}</strong></div>
      </div>
      <div className={styles.actions}>
        <div className={styles.searchWrap} ref={searchRef}>
          <label className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => { onQueryChange(event.target.value); setActiveIndex(0); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search your workspace"
              aria-label="Search courses, materials, and tasks"
              aria-autocomplete="list"
              aria-expanded={searchOpen && Boolean(query.trim())}
              aria-controls="workspace-search-results"
            />
          </label>
          {searchOpen && query.trim().length >= 2 && (
            <div className={styles.searchResults} id="workspace-search-results" role="listbox" aria-label="Search results">
              {searchResults.length ? searchResults.map((result, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? styles.searchResultActive : styles.searchResult}
                  key={result.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => { onSelectSearchResult?.(result); setSearchOpen(false); }}
                >
                  <span>{result.label}</span><small>{result.detail}</small>
                </button>
              )) : <p className={styles.noResults}>No matching courses, materials, or tasks.</p>}
            </div>
          )}
        </div>
        <button type="button" className={styles.avatarButton} title={`Manage profile for ${username}`} aria-label="Open profile settings" onClick={onOpenSettings}>
          {profilePicture ? <img src={profilePicture} alt="" /> : <span>{username.slice(0, 2).toUpperCase()}</span>}
          <span className={styles.camera}><UserRound size={10} /></span>
        </button>
        <span className={styles.username}>{username}</span>
        <button type="button" className={styles.logout} onClick={onLogout} title="Log out"><LogOut size={15} /><span>Log out</span></button>
      </div>
    </header>
  );
}
