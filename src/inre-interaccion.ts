import * as ecs from '@8thwall/ecs'

/*
 * Interacción con objetos: generado por INRE.
 *
 * Se reescribe en cada publicación. Para cambiar el comportamiento de una experiencia,
 * cámbialo en el editor; los cambios hechos aquí se pierden.
 *
 * El motor hace el raycast y despacha `screen-touch-start` AL TARGET tocado
 * (`pointer-events.ts:163`: `events.dispatch(data.target, event, data)`). Por eso se
 * escucha en la `eid` propia y no en `world.events.globalId`, que solo recibe los
 * toques que no dieron a nada.
 */

const COMPONENT = 'inre-interaccion'
const TIMELINE = 'inre-animacion'

const ACTION = 'accion'
const AUDIO_PARAM = 'audio'
const URL_PARAM = 'url'
const ONCE = 'unaVez'
const SHOW = 'mostrar'
const HIDE = 'ocultar'

ecs.registerComponent({
  name: COMPONENT,

  schema: {
    [ACTION]: ecs.string,
    [AUDIO_PARAM]: ecs.string,
    [URL_PARAM]: ecs.string,
    [ONCE]: ecs.boolean,
    /*
     * El objeto que se enseña o se oculta, por `eid`.
     *
     * Podría pensarse en un nombre, pero el motor NO indexa entidades por nombre: no
     * existe `ecs.Name` ni forma de recorrer el mundo desde un componente (`ecs.world`
     * no está en la API pública). El `eid` es lo único que el esquema puede guardar y
     * que el motor resuelve directo, así que el editor lo resuelve al exportar.
     *
     * Por eso estas acciones necesitan que el objeto destino sea un objeto de la
     * escena: el exportador conoce su entidad en tiempo de ejecución.
     */
    [SHOW]: ecs.eid,
    [HIDE]: ecs.eid,
  },

  schemaDefaults: {
    [ACTION]: 'nada',
    [AUDIO_PARAM]: '',
    [URL_PARAM]: '',
    [ONCE]: false,
  },

  data: {
    // Se toca una vez y ya no vuelve a dispararse: convierte un botón en algo de un
    // solo uso, como el CTA final de una experiencia.
    gastado: ecs.boolean,
    // Estado del interruptor de las acciones «alternar-*».
    alternado: ecs.boolean,
  },

  add: (world, component) => {
    component.data.gastado = false
    component.data.alternado = false

    /*
     * El listener se registra en `add` y NO en `tick`: uno por fotograma acumularía
     * miles en pocos segundos, y cada toque dispararía la acción tantas veces como
     * fotogramas hayan pasado desde que se abrió la experiencia.
     */
    const alTocar = () => {
      ejecutar(world, component)
    }

    world.events.addListener(component.eid, ecs.input.SCREEN_TOUCH_START, alTocar)
  },
})

const ejecutar = (world, component) => {
  if (component.data.gastado) {
    return
  }

  const accion = component.schema[ACTION] || 'nada'
  if (accion === 'nada') {
    return
  }

  switch (accion) {
    case 'reproducir-audio': {
      const url = component.schema[AUDIO_PARAM] || ''
      if (url === '') {
        console.warn('[INRE] La interacción pide audio y no hay ninguno elegido.')
        break
      }
      ecs.Audio.set(world, component.eid, {url, paused: false})
      break
    }

    case 'alternar-animacion': {
      /*
       * `paused` es el único interruptor que respetan todas las familias de animación
       * del motor (posición, escala, rotación, vector propio), así que alternar una
       * sola propiedad cubre las cuatro. El componente del timeline de INRE expone la
       * misma propiedad, de ahí que entre en la misma lista.
       */
      component.data.alternado = !component.data.alternado
      const paused = !component.data.alternado

      for (const nombreComponente of [
        'PositionAnimation',
        'ScaleAnimation',
        'RotateAnimation',
        'CustomVec3Animation',
        'FollowAnimation',
        'LookAtAnimation',
        TIMELINE,
      ]) {
        const Componente = ecs[nombreComponente]
        if (Componente !== undefined && Componente.has(world, component.eid)) {
          Componente.set(world, component.eid, {paused})
        }
      }
      break
    }

    case 'alternar-visibilidad': {
      /*
       * `Disabled` es lo que el motor entiende por oculto: saca la entidad del dibujado
       * y de los sistemas sin destruirla. Se comprueba `has` antes de `add` porque
       * añadirlo dos veces dispara el ciclo de vida dos veces.
       */
      const objetivo = component.schema[SHOW]
      if (objetivo === undefined) {
        console.warn('[INRE] La interacción no tiene objeto elegido.')
        break
      }

      component.data.alternado = !component.data.alternado
      if (component.data.alternado) {
        if (!ecs.Disabled.has(world, objetivo)) {
          // Disabled no tiene parámetros, así que no hay add: set sin datos es
          // justo lo que lo pone. No existe un add en RootAttribute.
          ecs.Disabled.set(world, objetivo)
        }
      } else if (ecs.Disabled.has(world, objetivo)) {
        ecs.Disabled.remove(world, objetivo)
      }
      break
    }

    case 'mostrar-objeto':
    case 'ocultar-objeto': {
      const objetivo = accion === 'mostrar-objeto'
        ? component.schema[SHOW]
        : component.schema[HIDE]

      if (objetivo === undefined) {
        console.warn('[INRE] La interacción no tiene objeto elegido.')
        break
      }

      if (accion === 'mostrar-objeto') {
        if (ecs.Disabled.has(world, objetivo)) {
          ecs.Disabled.remove(world, objetivo)
        }
      } else if (!ecs.Disabled.has(world, objetivo)) {
        ecs.Disabled.set(world, objetivo)
      }
      break
    }

    case 'abrir-url': {
      const url = component.schema[URL_PARAM] || ''
      if (url === '') {
        console.warn('[INRE] La interacción pide abrir una URL y no hay ninguna elegida.')
        break
      }
      window.open(url, '_blank', 'noopener,noreferrer')
      break
    }
  }

  /*
   * `abrir-url` no consume el toque aunque `ONCE` esté activo: el navegador puede
   * bloquear la ventana emergente —un toque ya gastado no se puede repetir— y dejar al
   * usuario sin poder abrirla nunca.
   */
  if (accion !== 'abrir-url' && component.schema[ONCE]) {
    component.data.gastado = true
  }
}
