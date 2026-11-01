# pantalla-violeta
Mostrar "Violeta" en la tablet y confirmarlo desde el host sin tocar la pantalla.
Runner: node --test tests/*.test.ts

## No-objetivos
- Sin UI más allá del texto "Violeta".
- Sin llamadas a NaN ni manejo de API key.
- Sin build release ni firma.

## Specs
S0. La app instala en la tablet y muestra el texto "Violeta".
    Accept: el host obtiene la cadena "Violeta" de la app corriendo, sin tocar la pantalla
    Check: manual: instalar con adb y leer el log de la corrida desde el host; aparece "Violeta"
S1. El paquete es dev.tasio.violeta y la app se llama "Violeta".
    Accept: el APK debug declara ese paquete y ese nombre
    Check: grep -q 'dev.tasio.violeta' android/app/build.gradle && grep -q 'Violeta' App.tsx

## Tasks
T0. Spike de punta a punta en la tablet — specs: S0 — test: n/a — riesgo: sí — commit: -
T1. Paquete y nombre — specs: S1 — test: recommended — riesgo: no — commit: -

## Decisiones
D1. Stack React Native + Expo (bare), build local, instalación por adb.

## Log
L1. Quiero ver Violeta en la tablet y que desde la terminal pueda saber que arrancó bien, sin tocar la pantalla.
