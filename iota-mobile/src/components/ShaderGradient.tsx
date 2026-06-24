import React from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';

export const ShaderGradient: React.FC = () => {
  const { width, height } = Dimensions.get('window');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #0A0A0C;
          }
          canvas {
            display: block;
            width: 100%;
            height: 100%;
          }
        </style>
      </head>
      <body>
        <canvas id="shader-canvas"></canvas>
        <script>
          (function() {
            const canvas = document.getElementById('shader-canvas');
            
            function syncSize() {
              const w = window.innerWidth || ${width};
              const h = window.innerHeight || ${height};
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
              }
            }
            window.addEventListener('resize', syncSize);
            syncSize();

            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return;

            const vs = \`
              attribute vec2 a_position;
              varying vec2 v_texCoord;
              void main() {
                v_texCoord = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
              }
            \`;

            const fs = \`
              precision highp float;
              varying vec2 v_texCoord;
              uniform float u_time;
              uniform vec2 u_resolution;

              vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
              vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
              vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

              float snoise(vec2 v) {
                const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy) );
                vec2 x0 = v -   i + dot(i, C.xx);
                vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod289(i);
                vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m;
                m = m*m;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
                vec3 g;
                g.x  = a0.x  * x0.x  + h.x  * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
              }

              void main() {
                vec2 uv = v_texCoord;
                float noise = snoise(uv * 2.0 + u_time * 0.1);
                
                // IOTA Palette: Violet, Mint, Cosmic Blue
                vec3 color1 = vec3(0.31, 0.27, 0.90); // #4F46E5
                vec3 color2 = vec3(0.06, 0.73, 0.51); // #10B981
                vec3 color3 = vec3(0.23, 0.51, 0.96); // #3B82F6
                vec3 bg = vec3(0.039, 0.039, 0.047); // #0A0A0C
                
                float m1 = snoise(uv + u_time * 0.05);
                float m2 = snoise(uv * 1.5 - u_time * 0.07);
                
                vec3 finalColor = mix(bg, color1, clamp(m1 * 0.8, 0.0, 1.0));
                finalColor = mix(finalColor, color2, clamp(m2 * 0.5, 0.0, 1.0));
                finalColor = mix(finalColor, color3, clamp(abs(noise) * 0.3, 0.0, 1.0));
                
                // Subtle Dither/Grain
                float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
                finalColor += (grain - 0.5) * 0.03;

                gl_FragColor = vec4(finalColor, 1.0);
              }
            \`;

            function cs(type, src) {
              const s = gl.createShader(type);
              gl.shaderSource(s, src);
              gl.compileShader(s);
              return s;
            }

            const prog = gl.createProgram();
            gl.attachShader(prog, cs(gl.VERTEX_SHADER, vs));
            gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, fs));
            gl.linkProgram(prog);
            gl.useProgram(prog);

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

            const pos = gl.getAttribLocation(prog, 'a_position');
            gl.enableVertexAttribArray(pos);
            gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

            const uTime = gl.getUniformLocation(prog, 'u_time');
            const uRes = gl.getUniformLocation(prog, 'u_resolution');

            function render(t) {
              if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
                syncSize();
              }
              gl.viewport(0, 0, canvas.width, canvas.height);
              if (uTime) gl.uniform1f(uTime, t * 0.001);
              if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              requestAnimationFrame(render);
            }
            render(0);
          })();
        </script>
      </body>
    </html>
  `;

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        source={{ html: htmlContent }}
        style={styles.webview}
        scrollEnabled={false}
        pointerEvents="none"
        domStorageEnabled={true}
        javaScriptEnabled={true}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  webview: {
    backgroundColor: 'transparent',
    opacity: 0.6,
  },
});
