# Lector Bilingüe EN⇄ES ✿

Compañera de lectura en inglés pensada para usar en un costado de la pantalla, en 1/4 del espacio, mientras leés. Traduce en vivo y te deja armar tu propio vocabulario.

👉 **Probala acá:** https://danna770.github.io/traductorBilingue/

## Qué hace

- **Traducción en vivo** inglés ⇄ español, con definiciones en los dos idiomas.
- **Preposiciones y frecuencia de uso** de cada palabra.
- **Pronunciación** en voz alta.
- **Vocabulario por secciones** (por ejemplo: Trabajo, Lectura actual, Phrasal verbs), con exportación a JSON.
- **🎯 Práctica:** quiz de opción múltiple con las palabras que guardaste.
- **Modo claro y oscuro.**

Funciona gratis con tres APIs lingüísticas (MyMemory, Free Dictionary y Datamuse) más un diccionario integrado.

## Cómo usarla

Abrí el link y empezá a traducir. **No hace falta cuenta, token ni clave.** Tus palabras se guardan en tu navegador.

### Opcional: sincronizar entre dispositivos (☁ Sync)

Solo si querés tener la misma lista en la PC y en el celular. Si no, salteá esta parte.

1. En **tu** cuenta de GitHub andá a *Settings → Developer settings → Personal access tokens → Tokens (classic)* y creá un token marcando **solo** el permiso `gist`.
2. En la app tocá **☁ Sync**, pegá el token y tocá **Conectar y sincronizar**.
3. En cada dispositivo pegá el mismo token.

Tu lista se guarda en un Gist secreto de **tu** cuenta, así que no se mezcla con la de nadie. El token queda guardado solo en tu navegador: no lo compartas ni lo pegues en ningún archivo.

### Opcional: IA para mejores ejemplos (⚙)

Si tenés una clave de **Google Gemini** u **OpenAI**, podés pegarla en ⚙ para mejorar modismos, preposiciones y oraciones de práctica. La clave también queda solo en tu navegador.

## Tecnologías

HTML · CSS · JavaScript · Web Speech API · GitHub Gist API. Incluye un servidor Node.js opcional (`server.js`) para usarla en tu PC con `npm start`, en http://localhost:3080.
