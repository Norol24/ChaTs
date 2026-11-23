export const OPTIONS = {
  skin: ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5a3725"],
  hair: ["#1b1b1b", "#4a2c12", "#8d5524", "#c99244", "#e6d3a3", "#d33f49", "#7a4de8", "#3a86ff", "#555b6e", "#f2f2f2"],
  eyes: ["#2b2b2b", "#4a2c12", "#2a6fdb", "#2ecc71", "#8e44ad", "#b8860b"],
  top: ["#fffc00", "#ff5c8a", "#40c4ff", "#7c4dff", "#2ecc71", "#ff6b3d", "#f5f5f5", "#111111", "#00b8a9"],
  bg: ["#fffc00", "#8ecae6", "#ffb4a2", "#cdb4db", "#ffd6a5", "#b8f2c9", "#f7c8d8", "#222233"],
};

export const HAIR_STYLES = [
  { id: "short", label: "Courts" },
  { id: "long", label: "Longs" },
  { id: "curly", label: "Bouclés" },
  { id: "bald", label: "Chauve" },
  { id: "cap", label: "Casquette" },
];

export const DEFAULT_AVATAR = { skin: 2, hair: 1, eyes: 0, top: 0, bg: 1, hairStyle: "short" };

export function normalizeAvatar(a) {
  const cfg = { ...DEFAULT_AVATAR, ...(a || {}) };
  for (const key of ["skin", "hair", "eyes", "top", "bg"]) {
    cfg[key] = Math.min(Math.max(0, Number(cfg[key]) || 0), OPTIONS[key].length - 1);
  }
  if (!HAIR_STYLES.some(s => s.id === cfg.hairStyle)) cfg.hairStyle = "short";
  return cfg;
}

export function renderAvatarSVG(avatarCfg) {
  const c = normalizeAvatar(avatarCfg);
  const skin = OPTIONS.skin[c.skin];
  const hair = OPTIONS.hair[c.hair];
  const eyes = OPTIONS.eyes[c.eyes];
  const top = OPTIONS.top[c.top];
  const bg = OPTIONS.bg[c.bg];

  let hairSvg = "";
  if (c.hairStyle === "short") {
    hairSvg = `<path d="M63,92 Q66,54 100,54 Q134,54 137,92 Q126,76 100,76 Q74,76 63,92 Z" fill="${hair}"/>`;
  } else if (c.hairStyle === "long") {
    hairSvg = `
      <path d="M63,92 Q66,54 100,54 Q134,54 137,92 Q126,76 100,76 Q74,76 63,92 Z" fill="${hair}"/>
      <rect x="61" y="84" width="13" height="56" rx="6.5" fill="${hair}"/>
      <rect x="126" y="84" width="13" height="56" rx="6.5" fill="${hair}"/>`;
  } else if (c.hairStyle === "curly") {
    hairSvg = `
      <circle cx="76" cy="64" r="15" fill="${hair}"/>
      <circle cx="100" cy="55" r="17" fill="${hair}"/>
      <circle cx="124" cy="64" r="15" fill="${hair}"/>
      <circle cx="66" cy="78" r="11" fill="${hair}"/>
      <circle cx="134" cy="78" r="11" fill="${hair}"/>`;
  } else if (c.hairStyle === "cap") {
    hairSvg = `
      <path d="M62,80 Q64,52 100,52 Q136,52 138,80 L62,80 Z" fill="${hair}"/>
      <rect x="56" y="76" width="88" height="10" rx="5" fill="${hair}"/>`;
  }

  return `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <rect width="200" height="200" fill="${bg}"/>
  <rect x="46" y="148" width="108" height="70" rx="26" fill="${top}"/>
  <rect x="89" y="126" width="22" height="24" rx="8" fill="${skin}"/>
  <circle cx="100" cy="96" r="38" fill="${skin}"/>
  ${hairSvg}
  <circle cx="86" cy="96" r="5" fill="${eyes}"/>
  <circle cx="114" cy="96" r="5" fill="${eyes}"/>
  <circle cx="87.6" cy="94.4" r="1.6" fill="#ffffff"/>
  <circle cx="115.6" cy="94.4" r="1.6" fill="#ffffff"/>
  <path d="M87,112 Q100,123 113,112" stroke="#3b2a1f" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="76" cy="106" rx="5" ry="3" fill="#ff9d9d" opacity="0.45"/>
  <ellipse cx="124" cy="106" rx="5" ry="3" fill="#ff9d9d" opacity="0.45"/>
</svg>`;
}

export function avatarHTML(avatarCfg) {
  return renderAvatarSVG(avatarCfg);
}
