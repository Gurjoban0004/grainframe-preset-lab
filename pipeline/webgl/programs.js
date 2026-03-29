import {
  vertexShader,
  colorFragmentShader,
  blurFragmentShader,
  sharpenFragmentShader,
  passthroughFragmentShader,
} from './shaders.js';

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }

  return shader;
}

function linkProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }

  gl.detachShader(program, vert);
  gl.detachShader(program, frag);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  return program;
}

export function createShaderPrograms(gl) {
  return {
    color: linkProgram(gl, vertexShader, colorFragmentShader),
    blur: linkProgram(gl, vertexShader, blurFragmentShader),
    sharpen: linkProgram(gl, vertexShader, sharpenFragmentShader),
    passthrough: linkProgram(gl, vertexShader, passthroughFragmentShader),
  };
}

/**
 * Cache uniform locations for a program to avoid per-frame lookups.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string[]} names
 * @returns {Record<string, WebGLUniformLocation>}
 */
export function getUniformLocations(gl, program, names) {
  const locations = {};
  for (const name of names) {
    locations[name] = gl.getUniformLocation(program, name);
  }
  return locations;
}
