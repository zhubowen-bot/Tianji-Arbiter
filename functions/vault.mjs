// AES-256-GCM 密文（与本机 vault.json 同源）。没有 ORACLE_MASTER_KEY 解不开，
// 主密码只以 Sites Secret 形式存在，不进源码、不进前端。
export const VAULT = {
  v: 1,
  alg: 'aes-256-gcm',
  iv: '2riKWZT+Yu0f+YR9',
  tag: 'yn6Cnz4RHOzySK/n1Ismmw==',
  data: 'OlgEhcC1QmPJJumX2f+DYOjlTlnniDqycT3Pf46S5XtcnGOVHTz84Q9WIg3nDzcWhRvwkJB+uDmRt2iCWzhlDmKXYL5DP1nhtk4QYkgA0CnvQo/gl2057Porto+ovNXffgXESnF5gfK4VNPKdEA1n301dCo='
};