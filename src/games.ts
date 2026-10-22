export interface Game {
  id: string;
  title: string;
  url: string;
  color: number;
  /** CSS px width the game renders at inside the screen; smaller values scale the game up. */
  viewportWidth?: number;
}

// On localhost the dev/preview server proxies /<repo>/ so the iframe is same-origin and Esc can be caught.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const pages = (repo: string) => (isLocal ? `/${repo}/` : `https://nickallan-kerv.github.io/${repo}/`);

export const games: Game[] = [
  { id: 'joust', title: 'Joust', url: pages('joust'), color: 0xffb020 },
  { id: 'nicman', title: 'Nicman', url: pages('nicman'), color: 0xffe94a },
  { id: 'hemeroids', title: 'Hemeroids', url: pages('hemeroids'), color: 0x4aff9e, viewportWidth: 1300 },
  { id: 'rubikscube', title: "Rubik's Cube", url: pages('rubikscube'), color: 0x4a9bff },
  { id: 'othello', title: 'Othello', url: pages('othello'), color: 0xff4a8a, viewportWidth: 1000 },
  { id: 'SpaceInvaders', title: 'Allan vs Aliens', url: pages('SpaceInvaders'), color: 0xb44aff, viewportWidth: 1170 },
];
