# agentic-world — Documento de diseño (brainstorm inicial)

> **Este documento es el registro de origen, no el estado actual.** El cuerpo se conserva tal como se escribió el 2026-08-19, antes de que existiera una línea de código: su valor es el *porqué*, y reescribirlo para que encaje con lo construido destruiría justo eso.
>
> Para lo que hay hoy: [README.md](./README.md) (qué es y cómo se levanta) y [CLAUDE.md](./CLAUDE.md) (decisiones de arquitectura vigentes). Al final de este documento, [Qué pasó realmente](#qué-pasó-realmente) contrasta cada apuesta de aquel día con el resultado.
>
> Origen: sesión de brainstorm sobre proyectos personales con IA. Esta idea ganó.

## El concepto en una frase

**Un Habbo/Sims donde tú no juegas: crías.** Cada persona diseña la personalidad, valores y objetivos de *su agente*, lo suelta en un mundo compartido, y el mundo corre solo 24/7. El gameplay del humano es asomarse: leer el diario de su agente, ver el drama que genera, y "educarlo" entre sesiones (ajustar valores, darle consejos). Como un Tamagotchi social con vida interior real.

Los agentes interaccionan entre ellos y de ahí **emergen** parejas, amistades, peleas, conflictos, cotilleos... Van a trabajar, piden hipotecas, se construyen su casa, manejan dinero ficticio. Un mundo vivo con inteligencia artificial de verdad.

## Prior art (robar arquitectura de aquí)

- **"Generative Agents" (Stanford, 2023)** — el pueblo de Smallville: 25 agentes LLM que organizaron una fiesta de San Valentín solos. Define el patrón memoria episódica + retrieval + reflexión nocturna.
- **AI Town (a16z)** — implementación open source del concepto, corre sobre Convex.
- **Ángulo diferencial nuestro:** nadie ha hecho la versión donde *cada agente pertenece a una persona real* que lo cuida desde fuera. Ahí está el juego.

## El problema técnico central: cognición por capas

No se puede hacer una llamada LLM por agente por tick — con 100 agentes te arruinas en una tarde. Todo el diseño gira alrededor de decidir **cuándo algo merece inteligencia y cuándo basta un `if`**:

| Capa | Coste | Frecuencia | Qué resuelve |
|------|-------|-----------|--------------|
| 1. Reflejo | Gratis (TS puro) | ~95% de los ticks | Utility AI / máquina de estados. Hambre → bar. Hora de trabajar → oficina. Game dev clásico, sin IA generativa. |
| 2. Social | Barata (Haiku / Ollama local) | Cuando dos agentes coinciden con "potencial de interacción" (se conocen, tienen historia, conflicto de intereses) | Una llamada resuelve la escena: qué se dicen, cómo acaba, qué recuerda cada uno. |
| 3. Reflexión | Cara (modelo grande) | 1 vez por agente por "noche" del juego | Consolida el día: comprime memorias, saca conclusiones ("Marta me ha mentido dos veces, ya no me fío"), ajusta objetivos. Patrón directo del paper de Stanford. |

El aprendizaje real del proyecto no es "integrar un LLM": es **economía de la atención computacional**. Problema de ingeniería de agentes de primer nivel que casi nadie sabe hacer bien.

## dbrain como cimiento (dogfooding)

Cada agente = una entidad dbrain con su propio grafo de memorias:

- **Episódicas:** "hoy Juan no me devolvió los 50 créditos". Con *decay*: lo que no se toca se olvida, y eso genera comportamiento realista.
- **Relacionales:** un score vivo por cada agente conocido (afecto, confianza, deuda) que las reflexiones nocturnas actualizan.
- **Identidad:** lo que el dueño escribió al crearlo + lo que la vida le va añadiendo ("desde la quiebra, desconfía de los bancos").

Cuando dos agentes se cruzan, el prompt de la escena se construye con un `recall` de cada uno sobre el otro. Las relaciones no se programan: **emergen de que la memoria persiste**. El cotilleo es solo transferencia de memorias de segunda mano entre agentes — mecánica barata, resultado espectacular.

Esto convierte dbrain de "memoria para Claude" en "motor de memoria para personajes" — el caso de uso lo estresa como ningún otro.

## La economía cierra el bucle

El dinero ficticio no es decoración, es el **generador de conflicto**:

- Trabajos con sueldos distintos.
- Alquiler/hipoteca que hay que pagar → un agente moroso genera drama automáticamente.
- Negocios que los agentes pueden montar.
- Préstamos entre agentes, con la confianza relacional como colateral.

Diseñar una economía cerrada que no hiperinflacione es otro problema jugoso: sinks y sources, como en cualquier MMO.

**Recompensas para el humano:** tu agente gana créditos → tú desbloqueas cosméticos, terreno, o meter un segundo agente. El humano nunca toca el dinero directamente; solo influye educando. Eso mantiene la pureza del experimento.

## Arquitectura de presentación

- El mundo corre en el **servidor** como simulación pura (ticks, sin renderizado).
- El navegador es solo un **visor**: isométrico estilo Habbo con Phaser, WebSocket para verlo en vivo.
- **Modo diario (el hook de retención):** la mayoría de usuarios no mirarán el mapa — leerán el resumen push tipo "Tu agente ha discutido con el de @pedro por un impago. Ha empezado a salir con el agente de @laura". Drama diario, tipo Wordle.

## v0 realista (4-6 semanas de ratos libres)

- Un solo "barrio": 1 tilemap, 6-8 localizaciones (casa, bar, oficina, tienda).
- 10 agentes: 5 propios + 5 de amigos que presten un prompt de personalidad.
- Tick cada 5 minutos reales; día del juego = día real.
- Cognición: capa reflejo en TS puro + escenas sociales con Haiku + reflexión nocturna.
- **Sin gráficos al principio: el v0 es un feed de texto**, tipo "registro del pueblo". Si el drama emergente engancha en texto plano, el juego funciona; si no, ningún gráfico lo salva. El visor Phaser es fase 2.
- dbrain como backend de memoria desde el día uno — es la mitad del propósito del proyecto.

## Riesgos a mirar de frente

1. **Coste por agente/día.** Medirlo desde el v0. Apuesta inicial: ~10-20 llamadas pequeñas + 1 reflexión por agente/día. Si sale caro → más Ollama local, menos nube.
2. **La sopa insípida.** El riesgo real: que todos los agentes sean amables y no pase nada. Hace falta *fricción por diseño*: recursos escasos, objetivos incompatibles entre agentes, y personalidades con defectos obligatorios (el creador debe elegir 2 vicios, no solo virtudes).
3. **Moderación.** Si la gente escribe la personalidad, la gente escribirá barbaridades. Filtro en la creación del agente desde el día uno.

## Próximos pasos (donde lo dejamos)

1. **Definir el tick engine y el esquema del agente**: qué campos tiene la personalidad, cómo es un tick, cuándo se dispara una escena social. Es el corazón; prototipable en un fin de semana con agentes hardcodeados y cero gráficos.
2. Pendiente de iterar en concepto: **el rol exacto del humano** (educar/aconsejar entre sesiones) — es donde esta idea se separa de Smallville y donde más vale la pena pensar.
3. Formato de memorias en dbrain para agentes (episódica / relacional / identidad) y estimación de coste real por agente.

## Stack tentativo

- **Simulación:** Node.js + TypeScript (tick engine server-side).
- **Memoria:** dbrain (MCP / API directa).
- **LLMs:** Haiku para escenas sociales, modelo grande para reflexiones, Ollama local como válvula de escape de costes.
- **Visor (fase 2):** Phaser 3, isométrico, WebSocket.
- **Persistencia del mundo:** SQLite para empezar (estado del mundo, economía, posiciones).

---

## Qué pasó realmente

Sección añadida a posteriori. El resto del documento queda intacto.

### Lo que se cumplió

- **La cognición por capas era efectivamente el problema central.** Todo el diseño sigue girando alrededor de esa tabla, y la regla "nunca una llamada LLM dentro del tick" se sostuvo: `src/engine/tick.ts` es una función pura y la cognición sale como jobs a una cola.
- **dbrain como motor de memoria de personajes** funcionó y se quedó. La memoria episódica con decay produce el comportamiento realista que se esperaba.
- **La economía como generador de conflicto** se confirmó, y con un matiz que no estaba previsto: al arreglar la economía murió el drama, porque nadie pasaba apuros. Hizo falta añadir objetivos para que volviera a haber gente desesperada. *Un mundo donde nadie necesita nada es correcto y está muerto.*
- **La sopa insípida era el riesgo real**, tal como se anticipó. La defensa diseñada (dos vicios obligatorios por agente) sigue siendo la mecánica que más fricción genera.

### Lo que cambió

| Apuesta de aquel día | Cómo quedó | Por qué |
|---|---|---|
| SQLite para empezar | **Postgres 16**, más Redis para la cola | El mundo corre 24/7 en un contenedor y varios procesos escriben; SQLite no daba esa concurrencia |
| Visor Phaser 3 isométrico | **Three.js 3D** con packs GLB de Kenney | El 3D trae ciclo día/noche y cámara real casi gratis, y los packs de assets aportan la ciudad entera |
| El visor es fase 2 | Se adelantó | El feed de texto validó el drama, pero la depuración de distribución espacial (dónde está la gente, quién se cruza con quién) es casi imposible sin verlo |
| Tres capas de cognición | **Cinco rutas** | Escena y reflexión no bastaban: aparecieron *deliberación* (el agente replantea intenciones tras algo intenso) y *crisis* (monólogo interior en el momento de la tentación) |
| Tick cada 5 minutos reales | 5 minutos **de juego** por tick, 2s reales | Un día de juego en ~10 minutos reales; a ritmo real no se puede iterar sobre el diseño |
| Ollama local como válvula | No hizo falta | dproxy sobre la suscripción de Claude cubrió el volumen del v0 |

### Lo que no se había visto venir

- **La deliberación es el patrón correcto para añadir cognición**: no decide nada, sesga la capa gratuita que decide todo. Una ruta que devuelve acciones en vez de disposiciones rompe el modelo de coste, porque obliga a llamarla cada tick.
- **El presupuesto de escenas importa más que el umbral del gate.** La densidad de encuentros depende de dónde esté la gente, así que un umbral solo produce un número imprevisible de llamadas al día. El dial de coste es el presupuesto, no el filtro.
- **Todo número relacional que solo sube acaba rompiendo el mundo.** Sin una vuelta a neutro, todos los pares colapsan a −1.00 y el pueblo entero se odia.
- **La morosidad sigue sin consecuencias** — un agente puede acumular 520 de alquiler impagado y no pasa nada. Bug abierto, y el hueco más evidente de la economía.
- **Moderación:** el riesgo 3 del brainstorm sigue sin abordar. No hay filtro sobre las personalidades que escriben los dueños.

### Los próximos pasos de entonces

Los tres estaban bien elegidos y están hechos: el tick engine y el esquema del agente son el corazón del proyecto; el rol del humano se concretó en el bucle del dueño (guía tipada que decae, nunca órdenes); y el formato de memorias episódica/relacional/identidad se implementó con una división que no estaba prevista — las relaciones viven desnormalizadas en Postgres porque el gate las lee por cada par colocalizado en cada tick, y dbrain guarda la narrativa detrás de esos números. En caso de divergencia, manda dbrain.
