# Sonara + Efí Bank: implantação controlada

Esta mudança foi preparada na branch `sonara-efi-polling`. Ela não instala
serviços, não publica Pages, não cria cobranças e não registra webhook.

## Arquitetura

`Cloudflare Pages (Sonara)` chama uma ponte própria da Sonara com um token
exclusivo. A ponte, na porta local `8081`, guarda o certificado mTLS e chama a
API Pix Efí. O Pages nunca recebe o `.p12`, a senha do certificado, Client ID
ou Client Secret.

O endpoint `payment-status` consulta a Efí autenticadamente para cada Pix
pendente. Só um status `CONCLUIDA` libera o pedido. A ponte usa uma trava
persistente por TXID para serializar a ativação; o e-mail usa chave de
idempotência e o evento Meta usa o ID estável do pedido.

Não há configuração de webhook Efí nesta implantação. Isso evita substituir a
URL associada à chave Pix que pertence à Nail. A contrapartida é a confirmação
por polling: o comprador precisa manter a página aberta, ou uma futura tarefa
agendada da Sonara deve consultar os pedidos pendentes. Nenhum status vindo do
navegador é aceito como pagamento.

## Variáveis do Cloudflare Pages — Sonara somente

Configure somente no projeto Pages confirmado como Sonara:

```text
EFI_BRIDGE_URL=https://<host-sonara>/sonara-efi
EFI_BRIDGE_TOKEN=<token-aleatorio-exclusivo-da-ponte>
```

As variáveis existentes continuam necessárias: `ORDERS_KV`, `RESEND_API_KEY`,
`FROM_EMAIL`, `META_PIXEL_ID`, `META_CAPI_TOKEN`, `SUNOR_API_KEY`,
`KIE_API_KEY`, `ADMIN_PASSWORD`, `OWNER_WHATSAPP`, `VAPID_*`,
`CALLMEBOT_API_KEY`, `CRON_SECRET` e as demais já usadas pela Sonara.

Nunca configurar no Pages: `EFI_CLIENT_SECRET`, conteúdo do `.p12`, senha do
certificado ou token de qualquer serviço Nail.

## VPS — somente após autorização separada

Os arquivos em `bridge/sonara-efi/` devem ser copiados para uma instalação
separada, por exemplo `/opt/sonara-efi`. Usar o unit `sonara-efi.service` e o
arquivo protegido `/etc/sonara-efi/sonara-efi.env`. O Nginx deve expor uma rota
ou host exclusivo da Sonara; não reutilizar ou editar a rota `efi-bridge` da
Nail.

Antes de iniciar, validar a versão Node 22 com `node:sqlite`, permissões do
certificado, HTTPS, token da ponte e resposta local de uma consulta simulada.

## Conferência obrigatória antes de qualquer deploy

Há três nomes históricos no repositório: `sonara-music-free` no `wrangler.toml`,
`masters-music` no script de deploy e `sonara-music` na especificação. Não
publique enquanto o projeto Pages que atende
`sonara-music-ewu.pages.dev` não for confirmado no painel Cloudflare ou por
`wrangler pages project list` com credencial de leitura. Ajuste o nome apenas
depois dessa confirmação.

## Teste sem movimentação financeira

1. `tsc --noEmit` e `node --check bridge/sonara-efi/server.mjs`.
2. Em homologação Efí, criar uma cobrança de baixo valor e validar QR, payload
   e consulta `ATIVA`/`CONCLUIDA`.
3. Verificar KV, painel, Resend, Meta CAPI e início de geração com dados de
   teste.
4. Repetir a consulta concorrente e confirmar uma única geração/e-mail/evento.
5. Só então, com autorização, realizar um Pix real de teste.
