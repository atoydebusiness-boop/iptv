# UltraStream IPTV

Projeto web (Vite + API serverless) para listar canais e reproduzir streams IPTV via proxy.

## Segurança (IMPORTANTE)

Se você deixar URL M3U com usuário/senha no código, qualquer pessoa pode descobrir.

Este projeto agora foi ajustado para usar **somente variáveis de ambiente**:

- `IPTV_M3U_URL` (obrigatória): URL M3U/HLS da sua lista.
- `STREAM_ACCESS_TOKEN` (recomendada): token exigido nas rotas `/api/channels`, `/api/stream` e `/api/series`.
- `VITE_STREAM_ACCESS_TOKEN` (frontend): deve ser igual ao `STREAM_ACCESS_TOKEN`.
- `STREAM_HOST_ALLOWLIST` (recomendada): hosts permitidos no proxy, separados por vírgula.

## Configuração

1. Instale dependências:
   ```bash
   npm install
   ```
2. Copie o `.env.example` para `.env.local` (ou variáveis no deploy):
   ```bash
   cp .env.example .env.local
   ```
3. Preencha as variáveis obrigatórias:
   - `IPTV_M3U_URL`
   - `STREAM_ACCESS_TOKEN`
   - `VITE_STREAM_ACCESS_TOKEN`
4. Rode localmente:
   ```bash
   npm run dev
   ```

## Observações

- Sem `IPTV_M3U_URL`, a API retorna erro e não usa fallback hardcoded.
- Com `STREAM_HOST_ALLOWLIST`, a API bloqueia streams fora da lista permitida.
