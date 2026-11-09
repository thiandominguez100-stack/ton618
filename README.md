# MILLER — Ocean World

Experiencia 3D de exploración libre en un océano planetario interminable, inspirada en el planeta Miller de *Interstellar*.

## La expedición

- Cámara de tercera persona con seguimiento y modo de primera persona; ambas permiten mirar libremente.
- Explorador animado con movimiento en el agua, impulso de nado, inmersión y una transición visual entre vadear y nadar.
- Flotación mediante un modelo ligero de fuerza restauradora y amortiguación: el personaje sube y baja siguiendo la superficie.
- Corrientes superficiales que influyen suavemente en el movimiento, más un empuje intenso cuando la gran marea se aproxima.
- Océano procedural de gran extensión que sigue al jugador; ondas superpuestas con desplazamiento horizontal tipo Gerstner simplificado.
- Reflejos aproximados del cielo, Fresnel, destellos solares, espuma de cresta, salpicaduras y anillos de ondas.
- Una ola colosal que avanza hacia el explorador, alcanza una distancia mínima, genera espuma y corriente, y luego se retira. El ciclo se repite.
- Gargantúa en el cielo, bruma atmosférica y un HUD con velocidad, altura del agua, dirección de la marea, distancia del frente y estado del explorador.

## Publicación

GitHub Actions despliega el sitio estático en GitHub Pages:

https://thiandominguez100-stack.github.io/ton618/

Código principal: `index.html` + `game.js`. No necesita servidor propio, Firebase ni instalación.

## Controles

- **W A S D**: desplazarse por el océano.
- **Ratón**: girar la cámara.
- **V**: alternar primera y tercera persona.
- **Ctrl**: sumergirse.
- **Espacio**: impulso de nado hacia arriba.
- **Shift**: desplazamiento rápido.
- **Esc**: pausar o continuar.
- En móvil: cruceta táctil para moverse y arrastre para mirar.

## Modelo físico y límites científicos

La superficie se calcula en el shader de GPU con ondas superpuestas y desplazamiento horizontal tipo Gerstner simplificado. El personaje sigue la altura local del agua mediante una fuerza de flotación aproximada con amortiguación; corrientes y empuje de marea modifican su velocidad. La gran ola tiene un frente animado con un ciclo de aproximación y retirada. Se añaden espuma y partículas para comunicar el movimiento.

No es una simulación CFD ni resuelve Navier–Stokes: no calcula el fluido volumétrico, turbulencia real ni transferencia de momento en tres dimensiones. La flotación es un modelo de juego, no un cálculo de ingeniería naval, y la ola es una representación cinemática inspirada en la película. Tampoco existen parámetros observacionales de un planeta Miller real; la escena no pretende ser una predicción numérica de un exoplaneta conocido.

## Referencias

- Kip Thorne, *The Science of Interstellar*, capítulo sobre Miller y las mareas; [extracto técnico](https://www.space.com/28077-science-of-interstellar-book-excerpt.html).
- [Entrevista de Scientific American a Kip Thorne sobre las olas de Miller](https://www.scientificamerican.com/blog/observations/parsing-the-science-of-interstellar-with-physicist-kip-thorne/).
- James, von Tunzelmann, Franklin & Thorne (2015), [Gravitational lensing by spinning black holes in astrophysics, and in the movie Interstellar](https://doi.org/10.1088/0264-9381/32/6/065001).
- [Three.js ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) y [PlaneGeometry](https://threejs.org/docs/pages/PlaneGeometry.html).

## Nota de inspiración

MILLER es una experiencia original inspirada en el concepto de un planeta oceánico y sus mareas extremas. Los nombres y elementos cinematográficos se usan como referencia temática; el juego no reproduce assets de la película.
