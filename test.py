from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)


completion = client.chat.completions.create(
  model="deepseek-ai/deepseek-v4-flash",
  messages=[{"role":"user","content":"what can you do ?"}],
  temperature=1,
  top_p=0.95,
  max_tokens=16384,
  extra_body={"chat_template_kwargs":{"thinking":True,"reasoning_effort":"high"}},
  stream=False
)

reasoning = getattr(completion.choices[0].message, "reasoning", None) or getattr(completion.choices[0].message, "reasoning_content", None)
if reasoning:
  print(reasoning)
print(completion.choices[0].message.content)