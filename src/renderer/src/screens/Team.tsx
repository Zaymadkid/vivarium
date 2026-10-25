import { useState } from "react";
import { Icon } from "../shell/icons";
import { ItemLogo } from "../shell/logo";
import { pushToast } from "../shell/toasts";
import { Chip, Empty, Modal, Screen, SectionLabel, TextInput } from "../shell/ui";

/**
 * Team — the reference's members screen (`MembersView` / `TeamView`).
 *
 * A row per person with a role chip and a logo tile from their name, plus the
 * invite sheet (email + optional name). Sending an invite adds a pending row, so
 * the list is real state rather than a static picture.
 */
type Role = "Owner" | "Admin" | "Member";

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  state: "active" | "invited";
}

const SEED: Member[] = [
  { id: "you", name: "You", email: "you@this.world", role: "Owner", state: "active" },
  { id: "alex", name: "Alex Turner", email: "alex@studio.co", role: "Member", state: "active" },
];

export function TeamScreen() {
  const [members, setMembers] = useState<Member[]>(SEED);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    const clean = email.trim();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(clean)) {
      setError("That email does not look right.");
      return;
    }
    setMembers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: name.trim() || clean.split("@")[0],
        email: clean,
        role: "Member",
        state: "invited",
      },
    ]);
    pushToast({ title: "Invite sent", body: clean, tone: "ok" });
    setEmail("");
    setName("");
    setError(null);
    setInviteOpen(false);
  };

  return (
    <Screen
      title="Team"
      subtitle="The people who share this world."
      actions={
        <button className="btn sm primary" onClick={() => setInviteOpen(true)}>
          <Icon name="plus" size={12} />
          Invite
        </button>
      }
    >
      <div className="team-list">
        {members.map((m, i) => (
          <div className="team-row" key={m.id} style={{ animationDelay: `${i * 40}ms` }}>
            <ItemLogo id={m.name} label={m.name} size={28} glyph="user" />
            <div className="team-who">
              <strong>{m.name}</strong>
              <em>{m.email}</em>
            </div>
            <Chip tone={m.role === "Owner" ? "warm" : "idle"}>{m.role}</Chip>
            <Chip tone={m.state === "active" ? "live" : "warn"} dot>
              {m.state}
            </Chip>
          </div>
        ))}
      </div>

      <SectionLabel>Companions on this team</SectionLabel>
      <div className="team-agents">
        {members.length === 0 && <Empty tight icon="users" title="No one yet" body="Invite someone." />}
        {["Wren", "Atlas"].map((a) => (
          <span className="team-agent" key={a}>
            <ItemLogo id={a} label={a} size={18} glyph="spark" />
            {a}
          </span>
        ))}
      </div>

      {inviteOpen && (
        <Modal title="Invite someone" onClose={() => setInviteOpen(false)} width={380}>
          <div className="form">
            <label className="field">
              <span>Email</span>
              <TextInput value={email} onChange={setEmail} placeholder="name@studio.co" />
            </label>
            <label className="field">
              <span>Name (optional)</span>
              <TextInput value={name} onChange={setName} placeholder="Alex Turner" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button className="btn ghost" onClick={() => setInviteOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={send}>
                Send invite
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Screen>
  );
}
