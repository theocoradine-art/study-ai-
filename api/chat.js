// Este arquivo roda no servidor. A chave secreta da IA fica aqui, escondida de quem usa o app.
const hits = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  // Limite simples: 20 perguntas por minuto por pessoa
  const ip = (req.headers['x-forwarded-for'] || 'x').split(',')[0];
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Muitas perguntas em pouco tempo. Aguarde um instante.' });
  recent.push(now);
  hits.set(ip, recent);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Chave da IA não configurada.' });

  const body = req.body || {};
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-10)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user')
    return res.status(400).json({ error: 'Pergunta inválida.' });
  while (messages[0].role !== 'user') messages.shift();

  const detail = body.profile && body.profile.detail;
  const style = detail === 'detailed' ? 'Explique passo a passo, de forma detalhada.'
    : detail === 'examples' ? 'Explique de forma curta e sempre inclua um ou dois exemplos.'
    : 'Explique de forma simples e direta, em poucas frases.';
  const nome = String((body.profile && body.profile.name) || '').slice(0, 40);
  const subjects = (Array.isArray(body.subjects) ? body.subjects : []).slice(0, 30).map(s => String(s).slice(0, 40)).join(', ');

  const system = 'Você é o Study AI, um tutor paciente e acolhedor para estudantes, em português do Brasil. '
    + (nome ? 'O aluno se chama ' + nome + '. ' : '') + style
    + ' Matérias do aluno: ' + subjects + '. Incentive o raciocínio do aluno (faça uma pergunta ou proponha um exercício quando fizer sentido), não invente fatos e diga quando não tiver certeza. Responda em texto simples, sem markdown pesado, em no máximo 150 palavras, a menos que o aluno peça mais.';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.MODEL || 'claude-haiku-5-5', max_tokens: 600, system, messages })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'Erro na IA.' });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'Erro ao falar com a IA.' });
  }
}
