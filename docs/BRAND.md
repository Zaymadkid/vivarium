# Brand

## The name

**Vivarium** — a glass world where living things grow under your eye.

Why it works:

- It describes the product literally: a living 3D world on your desktop that you keep
  alive, observe, and open up to others.
- It says *open* — a vivarium is a transparent box, not a walled garden.
- It has no baggage in developer tooling (checked: several *Mycel/Mycelium* AI projects
  already exist; "Vivarium" is a biological-simulation library, a different domain).
- Short form: **Viv**. CLI: `viv`. Package: `vivarium-os`.

**Tagline:** *An open world for agents.*

Supporting lines:

- *Bring your own mind.*
- *Your world stays on your machine.*
- *Any model. Any agent. One world.*

## What we are not

Not another chat window with a mascot bolted on. The name, palette, type scale, motion
and renderer are original to this project, and the product is built around one idea:
a world you keep, not a transcript you scroll.

## Mark

Three orbital arcs around a lit core — a cross-section of the vivarium, and a graph of
agents. Generated in code (`assets/mark.svg`), no binary art in the repo.

## Palette

Deep blue-black ground, bio-luminescent teal as the accent, violet for memory, amber
only for attention. The palette is deliberately cool and botanical: the world is lit by
the things inside it, not by a brand colour stamped on top.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#06080C` | app ground |
| `--panel` | `#0A0E14` | panels |
| `--surface` | `rgba(255,255,255,0.04)` | cards, rows |
| `--line` | `rgba(255,255,255,0.07)` | hairlines |
| `--text` | `rgba(255,255,255,0.92)` | headings |
| `--body` | `rgba(255,255,255,0.62)` | body |
| `--muted` | `rgba(255,255,255,0.35)` | meta |
| `--accent` | `#5EEAD4` | primary, selection, focus |
| `--accent-2` | `#A78BFA` | memory, secondary charts |
| `--warn` | `#FBBF24` | approval, degraded |
| `--bad` | `#F87171` | error, destructive |
| `--good` | `#34D399` | live, connected |

One-line swap if you want a warmer build: set `--accent: #FF6D00`. The whole UI follows
because nothing hard-codes a colour.

## Type

System UI stack, but with a readable floor: 12 px body, 13 px chat, 11 px meta, 10 px
uppercase labels with `0.18em` tracking. Numbers are tabular.

## Motion

`140 ms` standard, `200 ms` panels, `cubic-bezier(.2,.9,.3,1)`; springs `stiffness 320 /
damping 32` for cards. Ambient loops (orb breathing, memory drift) are 4–8 s and stop
under `prefers-reduced-motion`.

## Voice

Plain, warm, specific. No exclamation marks, no "Oops!". Errors say what happened and
what to do next. The product never calls itself an "AI companion" — it is a world and
the agents in it.

## Licence

Apache-2.0. Patent grant matters for a platform other people build on.
