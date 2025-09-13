/* Custom MapLibre GL layer to render 3D points (satellites) in space
 * using Mercator world coordinates with altitude in meters.
 */
import type { Map as MlMap } from 'maplibre-gl'

type GL = WebGLRenderingContext

export type SatPoint = { x: number; y: number; z: number; r?: number; g?: number; b?: number }

export function createSatellitePointLayer(id = 'satellite-points-3d') {
  let gl: GL | null = null
  let map: MlMap | null = null
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let colorBuffer: WebGLBuffer | null = null
  let aPosLoc = -1
  let aColLoc = -1
  let uMatrixLoc: WebGLUniformLocation | null = null
  let uPointSizeLoc: WebGLUniformLocation | null = null
  let uColorLoc: WebGLUniformLocation | null = null
  let positions: Float32Array = new Float32Array()
  let colors: Float32Array = new Float32Array()
  let needsUpload = false

  const vert = `
    precision mediump float;
    uniform mat4 u_matrix;
    uniform float u_pointSize;
    attribute vec3 a_pos;
    attribute vec3 a_col;
    varying vec3 v_col;
    void main(){
      gl_Position = u_matrix * vec4(a_pos, 1.0);
      gl_PointSize = u_pointSize;
      v_col = a_col;
    }
  `
  const frag = `
    precision mediump float;
    uniform vec3 u_color;
    varying vec3 v_col;
    void main(){
      // Sphere impostor shading for a lit look
      vec2 uv = gl_PointCoord * 2.0 - 1.0; // [-1,1]
      float r2 = dot(uv, uv);
      if (r2 > 1.0) discard; // circle cutout
      float z = sqrt(1.0 - r2);
      vec3 normal = normalize(vec3(uv, z));
      vec3 lightDir = normalize(vec3(0.6, 0.4, 1.0));
      float diff = max(dot(normal, lightDir), 0.0);
      float ambient = 0.25;
      vec3 base = v_col.r + v_col.g + v_col.b > 0.0 ? v_col : u_color;
      vec3 shaded = base * (ambient + (1.0 - ambient) * diff);
      gl_FragColor = vec4(shaded, 1.0);
    }
  `

  function createShader(gl: GL, type: number, src: string) {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      // eslint-disable-next-line no-console
      console.error('shader error', gl.getShaderInfoLog(s))
    }
    return s
  }

  function createProgram(gl: GL, vs: string, fs: string) {
    const p = gl.createProgram()!
    const v = createShader(gl, gl.VERTEX_SHADER, vs)
    const f = createShader(gl, gl.FRAGMENT_SHADER, fs)
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      // eslint-disable-next-line no-console
      console.error('program link error', gl.getProgramInfoLog(p))
    }
    return p
  }

  const layer: any = {
    id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(mapIn: MlMap, glIn: GL) {
      map = mapIn
      gl = glIn
      program = createProgram(gl, vert, frag)
      aPosLoc = gl.getAttribLocation(program!, 'a_pos')
      aColLoc = gl.getAttribLocation(program!, 'a_col')
      uMatrixLoc = gl.getUniformLocation(program!, 'u_matrix')
      uPointSizeLoc = gl.getUniformLocation(program!, 'u_pointSize')
      uColorLoc = gl.getUniformLocation(program!, 'u_color')
      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
      colorBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW)
      // eslint-disable-next-line no-console
      console.debug('[SatellitePointLayer] onAdd: shader/attribs ready', { aPosLoc, aColLoc, hasMatrix: !!uMatrixLoc })
    },
    render(glIn: GL, matrix: number[] | Float32Array) {
      if (!gl || !program || !buffer) return
      gl.useProgram(program)

      // Render on top of the globe for visibility while debugging
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)

      if (needsUpload) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
        if (colorBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
          gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW)
        }
        needsUpload = false
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(aPosLoc)
      gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 12, 0)
      if (colorBuffer && aColLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
        gl.enableVertexAttribArray(aColLoc)
        gl.vertexAttribPointer(aColLoc, 3, gl.FLOAT, false, 12, 0)
      }
      // Ensure Float32Array(16) for WebGL uniform
      const mat = new Float32Array(16)
      // Some environments pass a plain array; copy defensively
      for (let k = 0; k < 16; k++) mat[k] = (matrix as any)[k] ?? 0
      if (uMatrixLoc) gl.uniformMatrix4fv(uMatrixLoc, false, mat)
      if (uPointSizeLoc) gl.uniform1f(uPointSizeLoc, 20.0)
      // default warm color (amber)
      if (uColorLoc) gl.uniform3f(uColorLoc, 1.0, 0.7, 0.2)
      const count = positions.length / 3
      // eslint-disable-next-line no-console
      console.debug(`[SatellitePointLayer] render draw count=`, count)
      if (count > 0) gl.drawArrays(gl.POINTS, 0, count)
    },
    prerender() {},
    onRemove() {
      if (!gl) return
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      buffer = null
      colorBuffer = null
      program = null
      gl = null
      map = null
    },
    setPositions(worldPositions: SatPoint[]) {
      positions = new Float32Array(worldPositions.length * 3)
      colors = new Float32Array(worldPositions.length * 3)
      let i = 0
      let j = 0
      for (const p of worldPositions) {
        positions[i++] = p.x
        positions[i++] = p.y
        positions[i++] = p.z
        colors[j++] = p.r ?? 0
        colors[j++] = p.g ?? 0
        colors[j++] = p.b ?? 0
      }
      // eslint-disable-next-line no-console
      console.debug(`[SatellitePointLayer] setPositions n=`, worldPositions.length)
      needsUpload = true
      // Ensure the map requests a new frame to render updated buffers
      try { map?.triggerRepaint() } catch {}
    }
  }

  return layer
}
