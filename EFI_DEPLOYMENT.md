# Sonara + Efí Bank: implantação controlada

Esta mudança foi preparada na branch `sonara-efi-polling`. Ela não instala
serviços, não publica Pages, não cria cobranças e não registra webhook.

## Arquitetura

O caminho primário é inteiramente Cloudflare: `Cloudflare Pages (Sonara)`
chama o `sonara-efi-gateway` (Worker), que apresenta um binding de certificado
cliente mTLS para a API Pix Efí. O Pages nunca recebe o `.p12`, a chave privada,
Client ID, Client Secret ou chave Pix. Durable Object serializa a ativação por
TXID e o Cron Trigger do Worker executa os scanners. Nada nesta arquitetura
utiliza, altera ou compartilha a ponte, webhook, banco ou serviços da Nail.

O endpoint `payment-status` consulta a Efí autenticadamente para cada Pix
pendente. Só um status `CONCLUIDA` libera o pedido. A ponte usa uma trava
persistente por TXID para serializar a ativação; o e-mail usa chave de
idempotência e o evento Meta usa o ID estável do pedido.

Não há configuração de webhook Efí nesta implantação. Isso evita substituir a
URL associada à chave Pix que pertence à Nail. O Cron Trigger, a cada minuto,
chama dois scanners autenticados e exclusivos da Sonara:
`efi-settlement-scan` percorre pedidos Efí pendentes no KV e só aprova
`CONCLUIDA` com TXID e valor iguais; `production-scan` continua geração,
entrega e nova tentativa de e-mail para pedidos pagos. Portanto o comprador
pode fechar o navegador. Nenhum dado vindo do navegador é aceito como pagamento.

## Configuração Cloudflare — Sonara somente

No projeto Pages confirmado como Sonara, configure somente:

```text
EFI_BRIDGE_URL=https://<sonara-efi-gateway>.<subdominio-workers>.workers.dev
EFI_BRIDGE_TOKEN=<mesmo-valor-de-SONARA_EFI_GATEWAY_TOKEN-no-Worker>
SONARA_SETTLEMENT_TOKEN=<segredo-aleatorio-exclusivo-do-timer>
```

No Worker `sonara-efi-gateway`, configurar como segredos:
`EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, `EFI_PIX_KEY`,
`SONARA_EFI_GATEWAY_TOKEN`, `SONARA_SETTLEMENT_TOKEN` e
`SONARA_PAGES_ORIGIN`. Carregar um certificado PEM/chave privada exclusivos da
Sonara como binding mTLS `EFI_MTLS`; usar o Durable Object
`SONARA_ACTIVATIONS` e o Cron `* * * * *` do arquivo exemplo.

`SONARA_SETTLEMENT_TOKEN` deve ser configurado como segredo no Pages e ter o
mesmo valor somente no Worker Cron. As variáveis existentes continuam
necessárias: `ORDERS_KV`, `RESEND_API_KEY`,
`FROM_EMAIL`, `META_PIXEL_ID`, `META_CAPI_TOKEN`, `SUNOR_API_KEY`,
`KIE_API_KEY`, `ADMIN_PASSWORD`, `OWNER_WHATSAPP`, `VAPID_*`,
`CALLMEBOT_API_KEY`, `CRON_SECRET` e as demais já usadas pela Sonara.

Nunca configurar no Pages: `EFI_CLIENT_SECRET`, conteúdo do certificado,
chave privada, senha do certificado, chave Pix ou token de qualquer serviço
Nail.

## VPS — apenas contingência, após autorização separada

Usar a VPS somente se a conta Cloudflare não puder receber o certificado mTLS
ou se a Efí rejeitar o handshake do Worker em homologação. Neste cenário, os
arquivos em `bridge/sonara-efi/` podem criar apenas uma ponte de autenticação
na porta local `8081`. Não há timer systemd: o Cron continua no Worker.

A ponte de contingência não armazena músicas, arquivos de clientes, pedidos ou
histórico e não executa geração. O Nginx deve expor rota/host exclusivo da
Sonara; nunca reutilizar ou editar a rota `efi-bridge` da Nail.

Antes de iniciar, validar a versão Node 22 com `node:sqlite`, permissões do
certificado, HTTPS, token da ponte e resposta local de uma consulta simulada.
Somente após autorização: `systemctl daemon-reload` e iniciar exclusivamente o
serviço da ponte. Não registrar webhook Efí nem instalar timer. O Worker Cron
permanece responsável pelo polling.

## Conferência obrigatória antes de qualquer deploy

Há três nomes históricos no repositório: `sonara-music-free` no `wrangler.toml`,
`masters-music` no script de deploy e `sonara-music` na especificação. Não
publique enquanto o projeto Pages que atende `sonara-music-ewu.pages.dev` não
for confirmado. Verificação somente leitura no painel: **Cloudflare Dashboard
→ Workers & Pages → Pages**, abrir cada projeto candidato e em **Settings →
General → Project name** comparar o subdomínio `*.pages.dev`; em **Custom
domains** confirmar o domínio associado. Alternativamente, uma sessão já
autenticada pode executar `wrangler pages project list`. Não é necessário nem
deve ser enviado token pelo chat. Ajuste o nome apenas após essa confirmação.

## Teste sem movimentação financeira

1. `tsc --noEmit`, `node --check bridge/sonara-efi/server.mjs` e
   `node --test tests/efi-settlement-core.test.mjs`.
2. Em homologação Efí, criar uma cobrança de baixo valor pelo Worker mTLS e
   validar QR, payload e consulta `ATIVA`/`CONCLUIDA`.
3. Verificar KV, painel, Resend, Meta CAPI e início de geração com dados de
   teste.
4. Com a página fechada, observar duas execuções do Cron Worker e confirmar uma única
   geração/e-mail/evento; repetir uma consulta concorrente.
5. Só então, com autorização, realizar um Pix real de teste.
