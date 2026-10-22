import { defineConfig } from 'vite';

const target = 'https://nickallan-kerv.github.io';
const repos = ['joust', 'nicman', 'hemeroids', 'rubikscube', 'othello', 'SpaceInvaders'];
const proxy = Object.fromEntries(repos.map((r) => [`/${r}/`, { target, changeOrigin: true }]));

export default defineConfig({
  base: '/arcade/',
  server: { proxy },
  preview: { proxy },
});
