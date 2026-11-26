# Major dos Amigos — online

Leilão de CS2 pra jogar com os amigos pela internet. O jogo é o mesmo do arquivo original; o servidor só liga os navegadores.

## Como funciona
- Quem cria a sala é o **dono**: o jogo roda no navegador dele e os amigos recebem tudo ao vivo.
- Os amigos entram pelo link da sala (`?sala=CÓDIGO`), dão lance, escalam o time, vetam mapas e escolhem tática do próprio time.
- O dono precisa deixar a aba aberta enquanto jogam.

## Rodar no seu PC
```
npm install
npm start
```
Abra http://localhost:3000

## Subir pro GitHub (repositório privado)
1. Crie um repositório **Private** no GitHub.
2. Envie todos os arquivos desta pasta (não precisa da pasta `node_modules`).

## Publicar no Render
1. Em render.com: **New → Blueprint** e escolha o repositório (dê ao Render acesso ao repo privado quando ele pedir). O `render.yaml` já configura tudo.
   - Ou **New → Web Service**: Build `npm ci --omit=dev`, Start `npm start`, plano Free.
2. Em **Environment**, crie `SENHA` com uma senha da sala. O link do Render é público, então a senha impede estranhos de entrar.
3. Abra o link `https://SEU-APP.onrender.com`, crie a sala e mande o link pros amigos (junto com a senha).

## Bom saber
- Plano grátis do Render dorme depois de 15 min sem uso; a primeira abertura pode demorar ~1 min. Se o servidor reiniciar, o navegador do dono recria a sala com o mesmo código.
- Só o dono abre séries e mexe em pausa, velocidade e configurações.
- Quem entra depois do leilão começar assiste. Quem cair e voltar com o mesmo nome recupera o time.
- Até 8 técnicos.
- Fotos enviadas ficam só no navegador de quem enviou.
- "Jogar só neste aparelho" funciona como o jogo original, sem internet.
