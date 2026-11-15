# Gateway Efí + Cron da Sonara (Cloudflare)

Este é o caminho primário da Sonara: um Worker apresenta o certificado cliente
mTLS à Efí, guarda a trava de idempotência em Durable Object e executa os dois
scanners Pages a cada minuto por Cron Trigger.

Ele não tem webhook Efí e não usa nem modifica qualquer serviço, certificado,
chave Pix, banco, rota ou configuração da Nail Collection.

## Segredos do Worker

- `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, `EFI_PIX_KEY`: exclusivos da Sonara.
- `SONARA_EFI_GATEWAY_TOKEN`: protege chamadas Pages → Worker.
- `SONARA_SETTLEMENT_TOKEN`: protege chamadas Cron Worker → Pages scanners.
- `SONARA_PAGES_ORIGIN`: origem confirmada do projeto Pages Sonara.

O certificado e a chave privada devem ser carregados como binding mTLS da conta
Cloudflare; nunca como variável, arquivo no Git, KV ou Pages secret. A Efí
documenta que o certificado é obrigatório até no OAuth; o Worker executa essas
requisições com `env.EFI_MTLS.fetch`.

O arquivo `wrangler.toml.example` é deliberadamente não-publicável. Preencher
o ID do certificado, confirmar projeto/conta e testar em homologação são etapas
futuras que exigem autorização de implantação.
