/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
}

declare module 'lucide-react/dist/esm/icons/*.js' {
  import type { LucideIcon } from 'lucide-react';
  const icon: LucideIcon;
  export default icon;
}
