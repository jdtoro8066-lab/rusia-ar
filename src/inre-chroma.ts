import * as ecs from '@8thwall/ecs'

/**
 * Recorte por color (Chroma Key) en GPU para imágenes, texturas y vídeos.
 *
 * Lo genera INRE: se reescribe en cada publicación, así que editarlo a mano no sirve de
 * nada.
 */

const CACHE_KEY = "inre-chroma-v2"
const SHADOW_CACHE_KEY = "inre-chroma-shadow-v1"
const GLSL_PARS = "\nuniform float uChromaEnabled;\nuniform float uChromaR;\nuniform float uChromaG;\nuniform float uChromaB;\nuniform float uChromaSimilarity;\nuniform float uChromaSmoothness;\nuniform float uChromaFeather;\nuniform float uChromaSpill;\nuniform float uChromaDecode;\n\nvec3 inreLinearToSrgb(vec3 c) {\n  vec3 lo = c * 12.92;\n  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;\n  return mix(lo, hi, step(vec3(0.0031308), c));\n}\n\nvec3 inreSrgbToLinear(vec3 c) {\n  vec3 lo = c / 12.92;\n  vec3 hi = pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4));\n  return mix(lo, hi, step(vec3(0.04045), c));\n}\n\nvec3 inreRgbToYuv(vec3 c) {\n  float y = dot(c, vec3(0.299, 0.587, 0.114));\n  float u = (c.b - y) * 0.564;\n  float v = (c.r - y) * 0.713;\n  return vec3(y, u, v);\n}\n\nvec3 inreYuvToRgb(vec3 yuv) {\n  float y = yuv.x;\n  float u = yuv.y;\n  float v = yuv.z;\n  float r = y + v / 0.713;\n  float b = y + u / 0.564;\n  float g = (y - 0.299 * r - 0.114 * b) / 0.587;\n  return clamp(vec3(r, g, b), 0.0, 1.0);\n}\n\nfloat inreChromaDist(vec3 pxSrgb, vec3 keyYuv, float keySat) {\n  vec3 pxYuv = inreRgbToYuv(pxSrgb);\n  float yWeight = mix(1.0, 0.18, smoothstep(0.02, 0.14, keySat));\n  return length(vec2(length(pxYuv.yz - keyYuv.yz), (pxYuv.x - keyYuv.x) * yWeight));\n}\n\nfloat inreChromaMaskFromDist(float dist) {\n  float edge = max(uChromaSmoothness, 0.004);\n  return smoothstep(uChromaSimilarity, uChromaSimilarity + edge, dist);\n}\n\nvec4 inreApplyChroma(vec4 texSample, bool isLinear, vec2 uv) {\n  if (uChromaEnabled < 0.5) {\n    return texSample;\n  }\n  vec3 pxSrgb = isLinear\n    ? inreLinearToSrgb(clamp(texSample.rgb, 0.0, 1.0))\n    : clamp(texSample.rgb, 0.0, 1.0);\n  vec3 keyColor = clamp(vec3(uChromaR, uChromaG, uChromaB), 0.0, 1.0);\n  vec3 keyYuv = inreRgbToYuv(keyColor);\n  float keySat = length(keyYuv.yz);\n\n  float centerDist = inreChromaDist(pxSrgb, keyYuv, keySat);\n  float mask = inreChromaMaskFromDist(centerDist);\n\n  #ifdef USE_MAP\n    if (uChromaFeather > 0.01) {\n      #if __VERSION__ >= 300\n        vec2 texSize = max(vec2(textureSize(map, 0)), vec2(1.0));\n      #else\n        vec2 texSize = vec2(1024.0);\n      #endif\n      vec2 stepUv = uChromaFeather / texSize;\n      vec2 diagUv = stepUv * 0.7071;\n\n      float sum = mask * 4.0;\n      vec2 o1 = vec2(stepUv.x, 0.0);\n      vec2 o2 = vec2(0.0, stepUv.y);\n      vec2 o3 = vec2(diagUv.x, diagUv.y);\n      vec2 o4 = vec2(-diagUv.x, diagUv.y);\n\n      vec3 s1 = texture2D(map, uv + o1).rgb;\n      vec3 s2 = texture2D(map, uv - o1).rgb;\n      vec3 s3 = texture2D(map, uv + o2).rgb;\n      vec3 s4 = texture2D(map, uv - o2).rgb;\n      vec3 s5 = texture2D(map, uv + o3).rgb;\n      vec3 s6 = texture2D(map, uv - o3).rgb;\n      vec3 s7 = texture2D(map, uv + o4).rgb;\n      vec3 s8 = texture2D(map, uv - o4).rgb;\n\n      if (isLinear) {\n        s1 = inreLinearToSrgb(clamp(s1, 0.0, 1.0));\n        s2 = inreLinearToSrgb(clamp(s2, 0.0, 1.0));\n        s3 = inreLinearToSrgb(clamp(s3, 0.0, 1.0));\n        s4 = inreLinearToSrgb(clamp(s4, 0.0, 1.0));\n        s5 = inreLinearToSrgb(clamp(s5, 0.0, 1.0));\n        s6 = inreLinearToSrgb(clamp(s6, 0.0, 1.0));\n        s7 = inreLinearToSrgb(clamp(s7, 0.0, 1.0));\n        s8 = inreLinearToSrgb(clamp(s8, 0.0, 1.0));\n      } else {\n        s1 = clamp(s1, 0.0, 1.0);\n        s2 = clamp(s2, 0.0, 1.0);\n        s3 = clamp(s3, 0.0, 1.0);\n        s4 = clamp(s4, 0.0, 1.0);\n        s5 = clamp(s5, 0.0, 1.0);\n        s6 = clamp(s6, 0.0, 1.0);\n        s7 = clamp(s7, 0.0, 1.0);\n        s8 = clamp(s8, 0.0, 1.0);\n      }\n\n      sum += inreChromaMaskFromDist(inreChromaDist(s1, keyYuv, keySat)) * 2.0;\n      sum += inreChromaMaskFromDist(inreChromaDist(s2, keyYuv, keySat)) * 2.0;\n      sum += inreChromaMaskFromDist(inreChromaDist(s3, keyYuv, keySat)) * 2.0;\n      sum += inreChromaMaskFromDist(inreChromaDist(s4, keyYuv, keySat)) * 2.0;\n      sum += inreChromaMaskFromDist(inreChromaDist(s5, keyYuv, keySat));\n      sum += inreChromaMaskFromDist(inreChromaDist(s6, keyYuv, keySat));\n      sum += inreChromaMaskFromDist(inreChromaDist(s7, keyYuv, keySat));\n      sum += inreChromaMaskFromDist(inreChromaDist(s8, keyYuv, keySat));\n\n      mask = sum / 16.0;\n    }\n  #endif\n\n  if (keySat > 0.04 && uChromaSpill > 0.001) {\n    vec3 pxYuv = inreRgbToYuv(pxSrgb);\n    vec2 dir = keyYuv.yz / keySat;\n    float proj = dot(pxYuv.yz, dir);\n    if (proj > 0.0) {\n      float edge = max(uChromaSmoothness, 0.004);\n      float colorZone = 1.0 - smoothstep(uChromaSimilarity, uChromaSimilarity + edge + 0.22, centerDist);\n      float spillZone = max(colorZone, 1.0 - mask);\n      pxYuv.yz -= dir * (proj * clamp(spillZone * uChromaSpill, 0.0, 1.0));\n      pxSrgb = inreYuvToRgb(pxYuv);\n    }\n  }\n\n  vec3 outRgb = isLinear ? inreSrgbToLinear(pxSrgb) : pxSrgb;\n  return vec4(outRgb, texSample.a * mask);\n}\n"
const GLSL_HOOK = "\nvec4 inrePreMapDiffuse = diffuseColor;\n#include <map_fragment>\n#ifdef USE_MAP\n  #ifdef DECODE_VIDEO_TEXTURE\n    bool inreChromaLinear = true;\n  #else\n    bool inreChromaLinear = uChromaDecode > 0.5;\n  #endif\n  vec4 inreChromaSample = inreApplyChroma(sampledDiffuseColor, inreChromaLinear, vMapUv);\n  if (uChromaEnabled > 0.5 && inreChromaSample.a <= 0.002) discard;\n  diffuseColor = inrePreMapDiffuse * inreChromaSample;\n#endif\n"
const GLSL_SHADOW_HOOK = "\nvec4 inrePreMapDiffuse = diffuseColor;\n#include <map_fragment>\n#ifdef USE_MAP\n  #ifdef DECODE_VIDEO_TEXTURE\n    bool inreChromaLinear = true;\n  #else\n    bool inreChromaLinear = uChromaDecode > 0.5;\n  #endif\n  vec4 inreChromaSample = inreApplyChroma(sampledDiffuseColor, inreChromaLinear, vMapUv);\n  if (uChromaEnabled > 0.5 && inreChromaSample.a <= 0.35) discard;\n  diffuseColor = inrePreMapDiffuse * inreChromaSample;\n#endif\n"

const esDelMotor = (material: any): boolean =>
  material != null
  && material.userData != null
  && (material.userData.disposable === true || material.userData.video === true)

const parsearHex = (hex: string): [number, number, number] => {
  if (typeof hex === 'string') {
    const clean = hex.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
      return [
        parseInt(clean.slice(1, 3), 16) / 255,
        parseInt(clean.slice(3, 5), 16) / 255,
        parseInt(clean.slice(5, 7), 16) / 255,
      ]
    }
    if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
      return [
        parseInt(clean[1] + clean[1], 16) / 255,
        parseInt(clean[2] + clean[2], 16) / 255,
        parseInt(clean[3] + clean[3], 16) / 255,
      ]
    }
  }
  return [0, 177 / 255, 64 / 255]
}

const inyectarChroma = (fragmentShader: string, sombra = false): string => {
  if (fragmentShader.includes('inreApplyChroma')) {
    return fragmentShader
  }
  const conPars = fragmentShader.includes('#include <map_pars_fragment>')
    ? fragmentShader.replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\n' + GLSL_PARS)
    : fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_PARS)
  return conPars.replace('#include <map_fragment>', sombra ? GLSL_SHADOW_HOOK : GLSL_HOOK)
}

const uniformsDe = (material: any) => {
  if (material.userData == null) {
    material.userData = {}
  }
  if (material.userData.__inreChromaUniforms == null) {
    material.userData.__inreChromaUniforms = {
      uChromaEnabled: {value: 0},
      uChromaR: {value: 0},
      uChromaG: {value: 177 / 255},
      uChromaB: {value: 64 / 255},
      uChromaSimilarity: {value: 0.28},
      uChromaSmoothness: {value: 0.14},
      uChromaFeather: {value: 1.5},
      uChromaSpill: {value: 0.65},
      uChromaDecode: {value: 0},
    }
  }
  return material.userData.__inreChromaUniforms
}

const instalarShader = (material: any): boolean => {
  if (material.userData != null && material.userData.__inreChromaInstalled === true) {
    return false
  }
  if (material.userData == null) {
    material.userData = {}
  }
  material.userData.__inreChromaInstalled = true

  const prevCompile = typeof material.onBeforeCompile === 'function'
    ? material.onBeforeCompile.bind(material)
    : null
  const prevKey = typeof material.customProgramCacheKey === 'function'
    ? material.customProgramCacheKey.bind(material)
    : null

  material.customProgramCacheKey = () => {
    const base = prevKey != null ? prevKey() : ''
    return base === '' ? CACHE_KEY : base + '|' + CACHE_KEY
  }

  material.onBeforeCompile = (shader: any, renderer: any) => {
    if (prevCompile != null) {
      prevCompile(shader, renderer)
    }
    Object.assign(shader.uniforms, uniformsDe(material))
    shader.fragmentShader = inyectarChroma(shader.fragmentShader)
  }
  return true
}

const sombrasDe = (material: any, uniforms: any) => {
  if (material.userData == null) {
    material.userData = {}
  }
  const cache = material.userData.__inreChromaShadow
  if (cache != null) {
    if (cache.depth != null) {
      cache.depth.map = material.map ?? null
      cache.depth.alphaTest = material.alphaTest ?? 0
    }
    if (cache.distance != null) {
      cache.distance.map = material.map ?? null
      cache.distance.alphaTest = material.alphaTest ?? 0
    }
    return cache
  }

  const THREE = typeof window !== 'undefined' ? (window as any).THREE : undefined
  if (THREE?.MeshDepthMaterial == null || THREE?.MeshDistanceMaterial == null) {
    return null
  }

  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking ?? 3201,
    map: material.map ?? null,
    alphaTest: material.alphaTest ?? 0,
  })
  depth.customProgramCacheKey = () => SHADOW_CACHE_KEY
  depth.onBeforeCompile = (shader: any) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = inyectarChroma(shader.fragmentShader, true)
  }

  const distance = new THREE.MeshDistanceMaterial({
    map: material.map ?? null,
    alphaTest: material.alphaTest ?? 0,
  })
  distance.customProgramCacheKey = () => SHADOW_CACHE_KEY
  distance.onBeforeCompile = (shader: any) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = inyectarChroma(shader.fragmentShader, true)
  }

  const entry = {depth, distance}
  material.userData.__inreChromaShadow = entry
  return entry
}

const aplicarSombras = (objeto: any, material: any, sombras: {depth: any, distance: any} | null) => {
  if (objeto == null || sombras == null) {
    return
  }
  const asignar = (nodo: any) => {
    if (nodo?.isMesh === true && nodo.material === material) {
      if (nodo.customDepthMaterial !== sombras.depth) {
        nodo.customDepthMaterial = sombras.depth
      }
      if (nodo.customDistanceMaterial !== sombras.distance) {
        nodo.customDistanceMaterial = sombras.distance
      }
    }
  }
  asignar(objeto)
  if (typeof objeto.traverse === 'function') {
    objeto.traverse(asignar)
  }
}

const limpiarSombras = (objeto: any, sombras: {depth: any, distance: any} | null | undefined) => {
  if (objeto == null || sombras == null) {
    return
  }
  const limpiar = (nodo: any) => {
    if (nodo?.isMesh === true) {
      if (nodo.customDepthMaterial === sombras.depth) {
        nodo.customDepthMaterial = undefined
      }
      if (nodo.customDistanceMaterial === sombras.distance) {
        nodo.customDistanceMaterial = undefined
      }
    }
  }
  limpiar(objeto)
  if (typeof objeto.traverse === 'function') {
    objeto.traverse(limpiar)
  }
}

const esMapaSrgb = (material: any): number => {
  const mapa = material?.map
  if (mapa == null || material?.userData?.video === true) {
    return 0
  }
  return mapa.colorSpace === 'srgb' || mapa.encoding === 3001 ? 1 : 0
}

ecs.registerComponent({
  name: 'inre-chroma',
  schema: {
    enabled: ecs.boolean,
    color: ecs.string,
    similarity: ecs.f32,
    smoothness: ecs.f32,
    feather: ecs.f32,
    spill: ecs.f32,
  },
  schemaDefaults: {
    enabled: false,
    color: '#00b140',
    similarity: 0.28,
    smoothness: 0.14,
    feather: 1.5,
    spill: 0.65,
  },

  tick: (world, component) => {
    const objeto: any = world.three.entityToObject.get(component.eid)
    if (objeto == null) {
      return
    }

    const material = objeto.material
    if (!esDelMotor(material)) {
      return
    }

    const s = component.schema
    const u = uniformsDe(material)
    const [r, g, b] = parsearHex(s.color)

    u.uChromaEnabled.value = s.enabled ? 1 : 0
    u.uChromaR.value = r
    u.uChromaG.value = g
    u.uChromaB.value = b
    u.uChromaSimilarity.value = s.similarity
    u.uChromaSmoothness.value = s.smoothness
    u.uChromaFeather.value = s.feather
    u.uChromaSpill.value = s.spill
    u.uChromaDecode.value = esMapaSrgb(material)

    let recompilar = instalarShader(material)

    if (s.enabled && material.transparent !== true) {
      material.transparent = true
      recompilar = true
    }

    const sombras = s.enabled ? sombrasDe(material, u) : material.userData?.__inreChromaShadow
    if (s.enabled) {
      aplicarSombras(objeto, material, sombras)
    } else {
      limpiarSombras(objeto, sombras)
    }

    if (recompilar) {
      material.needsUpdate = true
    }
  },

  remove: (world, component) => {
    const objeto: any = world.three.entityToObject.get(component.eid)
    const material = objeto?.material
    const u = material?.userData?.__inreChromaUniforms
    if (u != null) {
      u.uChromaEnabled.value = 0
    }
    limpiarSombras(objeto, material?.userData?.__inreChromaShadow)
  },
})
