import { adaptShaderToyFragment } from "./scripts/shaders/shadertoy-adapter.js";
const src = `
float map(vec3 p){
  float s1=1.;
  float s2=2.;
  float s3=3.;
  /*
  float s1=4.;
  float s2=5.;
  float s3=6.;
  */
  return s1+s2+s3;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  fragColor=vec4(map(vec3(0.)),0.,0.,1.);
}`;
const out = adaptShaderToyFragment(src);
console.log('has_cpfx', /s1_cpfx|s2_cpfx|s3_cpfx/.test(out));
const m = out.match(/float map[\s\S]*?\n\}/);
console.log(m ? m[0] : 'no map');
