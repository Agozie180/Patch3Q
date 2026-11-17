/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PATCH3Q_REGISTRY_ADDRESS?: `0x${string}`;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
