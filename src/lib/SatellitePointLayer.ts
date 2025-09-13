/* Custom MapLibre GL layer to render 3D points (satellites) in space
 * using Mercator world coordinates with altitude in meters.
 */
import type { Map as MlMap } from 'maplibre-gl'

type GL = WebGLRenderingContext

export type SatPoint = { x: number; y: number; z: number }

export function createSatellitePointLayer(id = 'satellite-points-3d') {
  let gl: GL | null = null
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let aPosLoc = -1
  let uMatrixLoc: WebGLUniformLocation | null = null
  let uPointSizeLoc: WebGLUniformLocation | null = null
  let uColorLoc: WebGLUniformLocation | null = null
  let positions: Float32Array = new Float32Array()
  let needsUpload = false

  const vert = `
    precision mediump float;
    uniform mat4 u_matrix;
    uniform float u_pointSize;
    attribute vec3 a_pos;
    void main(){
      gl_Position = u_matrix * vec4(a_pos, 1.0);
      gl_PointSize = u_pointSize;
    }
  `
  const frag = `
    precision mediump float;
    uniform vec3 u_color;
    void main(){
      vec2 c = gl_PointCoord - vec2(0.5);
      if(dot(c,c) > 0.25) discard; // round point
      gl_FragColor = vec4(u_color, 1.0);
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
    onAdd(map: MlMap, glIn: GL) {
      gl = glIn
      program = createProgram(gl, vert, frag)
      aPosLoc = gl.getAttribLocation(program!, 'a_pos')
      uMatrixLoc = gl.getUniformLocation(program!, 'u_matrix')
      uPointSizeLoc = gl.getUniformLocation(program!, 'u_pointSize')
      uColorLoc = gl.getUniformLocation(program!, 'u_color')
      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
    },
    render(glIn: GL, matrix: number[]) {
      if (!gl || !program || !buffer) return
      gl.useProgram(program)

      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      if (needsUpload) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
        needsUpload = false
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(aPosLoc)
      gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 12, 0)
      gl.uniformMatrix4fv(uMatrixLoc, false, matrix as unknown as Float32Array)
      gl.uniform1f(uPointSizeLoc, 4.0)
      gl.uniform3f(uColorLoc, 1.0, 0.35, 0.35)
      const count = positions.length / 3
      if (count > 0) gl.drawArrays(gl.POINTS, 0, count)
    },
    prerender() {},
    onRemove() {
      if (!gl) return
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      buffer = null
      program = null
      gl = null
    },
    setPositions(worldPositions: SatPoint[]) {
      positions = new Float32Array(worldPositions.length * 3)
      let i = 0
      for (const p of worldPositions) {
        positions[i++] = p.x
        positions[i++] = p.y
        positions[i++] = p.z
      }
      needsUpload = true
    }
  }

  return layer
}

