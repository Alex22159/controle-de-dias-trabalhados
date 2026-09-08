# Controle de Trabalho

Site pessoal para marcar os dias trabalhados, para quem você trabalhou (com uma
seção separada para os clientes "Bico VIP"), quanto recebeu, e ver estatísticas
(total por pessoa, total geral, quanto já foi pago e quanto falta receber,
gráfico de tendência mensal, etc).

## Novidades desta versão

- **Login com usuário e senha.** Na primeira vez que abrir o site, você cria um
  usuário e senha — depois disso, é preciso entrar para acessar o app. Use
  "Alterar senha" ou "Sair" na aba Ajustes, e "Esqueci minha senha" na tela de
  login se precisar resetar o acesso (isso NÃO apaga seus lançamentos, só o
  usuário/senha).
  ⚠️ Importante: como o site não tem servidor por trás, essa senha é uma
  proteção simples de tela (evita que alguém pegue o aparelho e mexa sem
  saber a senha) — não é uma segurança forte como a de um banco, então não é
  o lugar para guardar informação ultra-sigilosa.
- **Clientes editáveis.** Em Ajustes você adiciona, edita (lápis) e remove
  quem você atende no trabalho normal (ex: ALEX, FIRMINO, NATAL, GIGIO,
  PORFIRIO, SCARPARO) e também os clientes do Bico VIP, cada um com seu
  próprio valor padrão (ex: ADRIANO = R$ 550,00).
- **Turno Diurno/Noturno.** Ao marcar um dia de trabalho normal, escolha o
  turno e o valor já vem preenchido com o padrão que você configurou (ex:
  Diurno R$ 330,00 / Noturno R$ 380,00) — mas pode alterar na hora se for
  diferente.
- **Pago × A receber.** Cada lançamento tem uma marcação "Já recebi esse
  valor". Nas Estatísticas, cada pessoa mostra o total gerado, o quanto já
  foi pago (verde) e o quanto ainda falta receber (amarelo) — junto com a
  soma total de todos os serviços.
- **Editar lançamentos.** Todo lançamento tem um ícone de lápis para editar
  (não só excluir).

Arquivos separados como você pediu:

```
controle-de-trabalho/
├── index.html        → estrutura da página
├── css/style.css      → toda a aparência visual
├── js/script.js       → toda a lógica/funcionalidade
├── manifest.json       → permite "instalar" o site no celular
├── sw.js               → faz o site funcionar offline depois da 1ª visita
├── icons/               → ícones do app
└── LEIA-ME.md            → este arquivo
```

**Onde ficam os dados?** Sem configurar o Supabase, os dados são salvos direto
no navegador do aparelho. Depois de configurar o Supabase, o app sincroniza um
único conjunto de dados entre celular, computador e tablet. O login ainda não é
individual nesta versão: qualquer aparelho com o link e a chave pública poderá
acessar esse conjunto de dados, portanto não use essa configuração para dados
confidenciais.

## Sincronizar celular e computador com Supabase

1. Crie uma conta em **https://supabase.com** e um projeto gratuito.
2. Abra o **SQL Editor**, cole o conteúdo de `supabase.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave
   **anon/public**.
4. Cole esses valores em `js/supabase-config.js`, nos campos `url` e `anonKey`.
5. Publique novamente a pasta no GitHub Pages.

O celular e o computador continuam mostrando telas próprias, mas passam a ler e
gravar os mesmos dados. O app busca alterações ao abrir, ao voltar para a aba e
a cada 15 segundos.

---

## Como colocar no ar (para acessar do celular de qualquer lugar)

Você não precisa saber programação para isso. Escolha uma opção:

### Opção 1 — Netlify Drop (a mais simples, sem precisar de conta)

1. Acesse **https://app.netlify.com/drop** no computador.
2. Arraste a pasta `controle-de-trabalho` inteira para a área indicada no site.
3. Em poucos segundos você recebe um link tipo `https://nome-aleatorio.netlify.app`.
4. Abra esse link no celular (ou salve nos favoritos / tela inicial).

Esse link é permanente enquanto o site existir no Netlify — mas se quiser um
endereço que você controla e pode atualizar quando quiser, crie uma conta
grátis (dá pra usar login do Google/GitHub) e continue publicando arrastando a
pasta sempre que atualizar algo.

### Opção 2 — Vercel

1. Crie uma conta grátis em **https://vercel.com** (pode ser com o Google).
2. Clique em "Add New" → "Project" → "Deploy" e envie a pasta do projeto
   (ou conecte um repositório do GitHub, veja Opção 3).
3. Você recebe um link `https://seu-projeto.vercel.app`.

### Opção 3 — GitHub Pages (bom se você já usa GitHub)

1. Crie um repositório novo no GitHub e envie todos os arquivos desta pasta
   para ele.
2. Vá em **Settings → Pages**, em "Source" escolha a branch `main` e a pasta
   `/root`, e salve.
3. Em alguns minutos o site fica disponível em
   `https://seu-usuario.github.io/nome-do-repositorio/`.

### Opção 4 — Acessar do celular sem publicar na internet (mesma Wi-Fi)

Se você só quer usar do celular em casa, sem publicar o site para o mundo,
dá pra rodar um servidor local no computador:

1. Instale o [Python](https://www.python.org/) (a maioria dos Mac/Linux já
   vem com ele).
2. Abra o Terminal/Prompt de Comando dentro da pasta `controle-de-trabalho` e
   rode:
   ```
   python3 -m http.server 8080
   ```
3. Descubra o IP do computador na rede Wi-Fi:
   - Windows: `ipconfig` (procure "Endereço IPv4")
   - Mac/Linux: `ifconfig` ou `ip a` (procure algo como `192.168.x.x`)
4. No celular (conectado na **mesma Wi-Fi**), abra o navegador e acesse:
   ```
   http://SEU-IP-AQUI:8080
   ```
   Exemplo: `http://192.168.0.15:8080`

Isso só funciona enquanto o computador estiver ligado, com o comando rodando,
e o celular na mesma rede — para acessar de qualquer lugar (dados móveis,
outra rede), use uma das opções 1 a 3.

---

## Instalar como aplicativo no celular

Depois de publicar (opções 1, 2 ou 3), abra o link no navegador do celular:

- **Android (Chrome):** toque nos três pontinhos → "Adicionar à tela inicial"
  ou "Instalar aplicativo".
- **iPhone (Safari):** toque no ícone de compartilhar (quadrado com seta) →
  "Adicionar à Tela de Início".

O ícone do app aparece na tela como qualquer outro aplicativo, abre em tela
cheia (sem a barra do navegador) e continua funcionando mesmo sem internet
depois da primeira vez que abrir.

---

## Atualizando o site depois de publicado

Se você editar os arquivos (por exemplo, pedir para eu mudar alguma cor ou
funcionalidade), é só repetir o processo de publicação (arrastar de novo no
Netlify, ou enviar os arquivos atualizados no GitHub/Vercel). Seus dados
salvos no celular/computador não são afetados — eles ficam no navegador, não
nos arquivos do site.
