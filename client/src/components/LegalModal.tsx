import React from 'react';
import { X, Shield, FileText } from 'lucide-react';

interface LegalModalProps {
  type: 'privacy' | 'terms';
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ type, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent-terracotta)]">
              {type === 'privacy' ? <Shield className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
            </div>
            <h2 className="font-serif-claude text-lg font-medium text-[var(--text-primary)]">
              {type === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Placeholder disclaimer banner */}
        <div className="mx-6 mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wider text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded">
            Draft
          </span>
          <span>Placeholder legal notice — edit and customize before public launch.</span>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs text-[var(--text-secondary)] leading-relaxed">
          {type === 'privacy' ? (
            <>
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">1. Information We Collect</h3>
                <p>
                  We collect account information you provide during signup (email address, username, display name, profile bio, and avatar image). We store message history, attachments, emoji reactions, and audit timestamps needed to deliver communication features.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">2. How We Use Information</h3>
                <p>
                  Your information is used strictly to provide real-time messaging, direct chat invitations, group chat features, profile discoverability, and account security. We do not sell your personal data or share it with third-party advertisers.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">3. Data Export & Account Deletion</h3>
                <p>
                  You have the right to download a complete machine-readable JSON copy of your profile, chats, and sent messages at any time under Account Settings. You may also permanently delete your account, which strips your profile details and deletes all your stored avatars and uploaded files from disk.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">4. Cookies & Security</h3>
                <p>
                  We use secure, HttpOnly, SameSite cookies to manage authenticated sessions and protect against cross-site request forgery (CSRF). Session tokens are never exposed in URLs or stored in localStorage.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">5. Contact & Updates</h3>
                <p>
                  For privacy questions, data requests, or security disclosures, please contact the site administrator. Policy updates will be reflected on this page with updated effective dates.
                </p>
              </section>
            </>
          ) : (
            <>
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">1. Acceptance of Terms</h3>
                <p>
                  By creating an account or accessing BaigChat, you agree to comply with and be bound by these Terms of Service. If you do not agree with any part of these terms, please discontinue use of the service.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">2. User Conduct & Acceptable Use</h3>
                <p>
                  You agree not to use the platform for unlawful purposes, harassment, hate speech, spam, distributing malicious software, or violating the intellectual property of others. Group administrators have moderation authority within their respective groups.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">3. Account Responsibility</h3>
                <p>
                  You are responsible for maintaining the confidentiality of your account password and session credentials. You agree to notify administrators immediately of any unauthorized access or security breaches.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">4. Termination & Moderation</h3>
                <p>
                  We reserve the right to suspend or terminate accounts that violate community rules or compromise system stability. Users may close their account at any time via Account Settings.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">5. Disclaimer & Limitation of Liability</h3>
                <p>
                  BaigChat is provided on an "as is" and "as available" basis without warranties of any kind. Under no circumstances shall the operators be liable for indirect, incidental, or consequential damages arising from service usage.
                </p>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-base)]/50 flex justify-end">
          <button
            onClick={onClose}
            className="py-1.5 px-4 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
