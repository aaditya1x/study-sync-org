import { useEffect, useRef, useState } from "react";
import {
  Monitor,
  Moon,
  Sun,
  Palette,
  Database,
  ShieldCheck,
  Camera,
  Trash2,
  LoaderCircle,
  RefreshCw,
  Check,
  X,
} from "lucide-react";

import { ThemeSwitcher } from "../ThemeSwitcher/index.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { supabase, STORAGE_BUCKETS } from "../../lib/supabase.js";
import styles from "./SettingsPanel.module.css";

const BUCKET = STORAGE_BUCKETS.profiles;
const PROFILE_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function storageError(error) {
  if (/bucket not found/i.test(error?.message || "")) {
    return new Error(`Supabase Storage bucket "${BUCKET}" is missing. Review and run the existing-project migration.`);
  }
  return error;
}

function initials(name = "Student") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "S";
}

export default function SettingsPanel({
  notify,
  username = "Student",
  profilePicture = "",
  onProfilePictureChange,
  onOpenAcademicProfile,
}) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(profilePicture);
  const [loading, setLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setPhoto(profilePicture);
  }, [profilePicture]);

  useEffect(() => {
    let active = true;

    async function loadSavedPicture() {
      if (!supabase) {
        setPhotoError("Connect Supabase to load a cloud profile photo.");
        return;
      }

      setPhotoLoading(true);
      setPhotoError("");
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data.user) throw new Error("Sign in again to load your profile photo.");

        const path = data.user.user_metadata?.avatar_path;
        if (!path) {
          if (active) {
            setPhoto("");
            onProfilePictureChange?.("");
          }
          return;
        }

        const { data: signed, error: signedError } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, 3600);
        if (signedError) throw storageError(signedError);
        if (active) {
          setPhoto(signed.signedUrl);
          onProfilePictureChange?.(signed.signedUrl);
        }
      } catch (error) {
        if (active) setPhotoError(error.message || "Could not load your saved profile photo.");
      } finally {
        if (active) setPhotoLoading(false);
      }
    }

    loadSavedPicture();
    return () => { active = false; };
  }, [onProfilePictureChange, loadAttempt]);

  async function selectPicture(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!PROFILE_IMAGE_TYPES[file.type]) {
      notify("Choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify("Profile image must be 2 MB or smaller.");
      return;
    }
    if (!supabase) {
      notify("Supabase is not configured. Check your environment settings.");
      return;
    }

    setLoading(true);
    setPhotoError("");
    setConfirmRemove(false);
    let uploadedPath = "";
    let previousPath = "";

    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error("Please log in first.");

      const user = data.user;
      previousPath = user.user_metadata?.avatar_path || "";
      const path = `${user.id}/profile.${PROFILE_IMAGE_TYPES[file.type]}`;
      const { data: uploaded, error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw storageError(uploadError);
      uploadedPath = uploaded.path;

      const { data: signedData, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(uploaded.path, 3600);
      if (signedError) throw storageError(signedError);

      if (path !== previousPath) {
        const { error: updateError } = await supabase.auth.updateUser({
          data: { ...user.user_metadata, avatar_path: path },
        });
        if (updateError) throw updateError;
      }

      setPhoto(signedData.signedUrl);
      onProfilePictureChange?.(signedData.signedUrl);
      setPhotoError("");

      if (previousPath && previousPath !== path) {
        const { error: cleanupError } = await supabase.storage
          .from(BUCKET)
          .remove([previousPath]);
        if (cleanupError) {
          console.error("Could not remove previous profile photo:", cleanupError);
          notify("New profile photo saved. The old photo could not be cleaned up.");
          return;
        }
      }

      notify("Profile photo saved to your account.");
    } catch (error) {
      if (uploadedPath && uploadedPath !== previousPath) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([uploadedPath]);
        if (cleanupError) console.error("Could not clean up failed profile photo upload:", cleanupError);
      }
      console.error("Profile photo upload failed:", error);
      notify(error.message || "Could not upload profile photo.");
    } finally {
      setLoading(false);
    }
  }

  async function removePicture() {
    if (!supabase) {
      notify("Supabase is not configured. Check your environment settings.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error("Please log in first.");

      const oldPath = data.user.user_metadata?.avatar_path;
      const { error: updateError } = await supabase.auth.updateUser({
        data: { ...data.user.user_metadata, avatar_path: null },
      });
      if (updateError) throw updateError;

      setPhoto("");
      onProfilePictureChange?.("");
      setPhotoError("");
      setConfirmRemove(false);

      if (oldPath) {
        const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath]);
        if (removeError) {
          console.error("Could not delete old photo:", removeError);
          notify("Profile photo removed from your account, but its stored file could not be deleted.");
          return;
        }
      }

      notify("Profile photo removed.");
    } catch (error) {
      console.error("Profile photo removal failed:", error);
      notify(error.message || "Could not remove profile photo.");
    } finally {
      setLoading(false);
    }
  }

  const themeShortcuts = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ];

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <p>PREFERENCES</p>
        <h1>Settings</h1>
        <span>Make your study workspace feel like yours.</span>
        <button type="button" className={styles.primaryButton} onClick={onOpenAcademicProfile}>My Academic Profile</button>
      </div>

      <div className={styles.panel}>
        <section className={styles.section} aria-labelledby="profile-heading">
          <div className={styles.sectionIntro}>
            <span className={styles.icon}><Camera size={19} /></span>
            <div className={styles.copy}>
              <h2 id="profile-heading">Profile picture</h2>
              <p>Shown in your workspace and saved with your account. JPEG, PNG, WebP, or GIF · up to 2 MB.</p>
            </div>
          </div>

          <div className={styles.profileControls}>
            <div className={styles.profilePreview}>
              {photo ? (
                <img
                  src={photo}
                  alt={`${username}'s profile`}
                  onError={() => {
                    setPhotoError("The photo link expired or could not be loaded. Refresh it to try again.");
                    setPhoto("");
                    onProfilePictureChange?.("");
                  }}
                />
              ) : <span>{initials(username)}</span>}
            </div>
            <div className={styles.photoActions}>
              <input
                ref={fileRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={selectPicture}
                disabled={loading}
              />
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => fileRef.current?.click()}
                disabled={loading || !supabase}
              >
                {loading ? <LoaderCircle className={styles.spinner} size={16} /> : <Camera size={16} />}
                {loading ? "Saving photo…" : photo ? "Change photo" : "Upload photo"}
              </button>
              {photo && !confirmRemove && (
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => setConfirmRemove(true)}
                  disabled={loading}
                >
                  <Trash2 size={15} /> Remove
                </button>
              )}
              {confirmRemove && (
                <div className={styles.confirmRemove} role="group" aria-label="Confirm profile photo removal">
                  <span>Remove this photo?</span>
                  <button type="button" onClick={removePicture} disabled={loading} aria-label="Confirm remove photo">
                    <Check size={14} /> Remove
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} disabled={loading} aria-label="Cancel photo removal">
                    <X size={14} /> Keep
                  </button>
                </div>
              )}
              {photoLoading && <small className={styles.help}>Loading saved photo…</small>}
              {photoError && (
                <div className={styles.inlineError} role="status">
                  <span>{photoError}</span>
                  <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} disabled={photoLoading || loading}>
                    <RefreshCw size={13} /> Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="appearance-heading">
          <div className={styles.sectionIntro}>
            <span className={styles.icon}><Palette size={19} /></span>
            <div className={styles.copy}>
              <h2 id="appearance-heading">Appearance</h2>
              <p>Choose a quick theme or select any of the full color palettes.</p>
            </div>
          </div>

          <div className={styles.appearanceControls}>
            <div className={styles.themeChoices} role="group" aria-label="Quick theme choices">
              {themeShortcuts.map(({ value, label, Icon }) => (
                <button
                  type="button"
                  key={value}
                  className={`${styles.themeChoice} ${theme === value ? styles.themeChoiceActive : ""}`}
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  {theme === value && <Check className={styles.themeCheck} size={14} />}
                </button>
              ))}
            </div>
            <div className={styles.fullTheme}>
              <span>Color palette</span>
              <ThemeSwitcher compact />
            </div>
            <p className={styles.themeStatus} aria-live="polite">
              Active: <strong>{theme}</strong>{theme === "system" ? ` · currently ${resolvedTheme}` : ""}
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="cloud-heading">
          <div className={styles.sectionIntro}>
            <span className={styles.icon}><Database size={19} /></span>
            <div className={styles.copy}>
              <h2 id="cloud-heading">Cloud profile</h2>
              <p>Your photo path is saved to your signed-in Supabase account. The image stays in private Storage.</p>
            </div>
            <span className={styles.status}><Check size={14} /> Account linked</span>
          </div>
        </section>

        <section className={`${styles.section} ${styles.lastSection}`} aria-labelledby="privacy-heading">
          <div className={styles.sectionIntro}>
            <span className={styles.icon}><ShieldCheck size={19} /></span>
            <div className={styles.copy}>
              <h2 id="privacy-heading">Privacy</h2>
              <p>Private profile photos are delivered using short-lived signed links. Storage access should remain limited to your account folder.</p>
            </div>
            <span className={styles.privacyBadge}>Private storage</span>
          </div>
        </section>
      </div>
    </section>
  );
}
