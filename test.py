import sys
import json
from openai import OpenAI

# Reconfigure stdout to handle UTF-8/emojis on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Initialize the client pointing to your secure VPS subdomain
client = OpenAI(
    base_url="https://chatllm.dathcodes.dev/v1",
    api_key="ollama" 
)

# Define a mock tool function
def get_current_weather(location: str, unit: str = "celsius"):
    """Get the current weather for a location."""
    print(f"\n[Tool Execution] get_current_weather called with location='{location}', unit='{unit}'")
    location_lower = location.lower()
    if "tokyo" in location_lower:
        return json.dumps({"location": "Tokyo", "temperature": "12", "condition": "Sunny", "unit": unit})
    elif "paris" in location_lower:
        return json.dumps({"location": "Paris", "temperature": "18", "condition": "Rainy", "unit": unit})
    elif "san francisco" in location_lower:
        return json.dumps({"location": "San Francisco", "temperature": "65", "condition": "Windy", "unit": unit})
    else:
        return json.dumps({"location": location, "temperature": "20", "condition": "Partly Cloudy", "unit": unit})

# Map functions
available_functions = {
    "get_current_weather": get_current_weather
}

def run_agent_conversation():
    print("=== Testing Tool Calling & Agent Behavior ===")
    model_name = "qcwind/qwen3-8b-instruct-Q4-K-M:latest"
    print(f"Target Model: {model_name}")

    # 1. Define the tools JSON schema
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_current_weather",
                "description": "Get the current weather in a given location",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "The city and state, e.g. San Francisco, CA",
                        },
                        "unit": {"type": "string", "enum": ["celsius", "fahrenheit"], "default": "celsius"},
                    },
                    "required": ["location"],
                },
            },
        }
    ]

    messages = [
        {"role": "system", "content": "You are a helpful assistant with access to tools. Always use the provided tools to lookup information when needed."},
        {"role": "user", "content": "What is the weather like in Paris right now?"}
    ]

    print(f"User Prompt: {messages[1]['content']}\n")
    print("Sending initial request to model...")
    
    try:
        # 2. Make the first API call proposing the tools
        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )
        
        response_message = response.choices[0].message
        tool_calls = response_message.tool_calls
        
        # Check if the model decided to call a tool
        if tool_calls:
            print(f"Model decided to call {len(tool_calls)} tool(s).")
            # Append the assistant's reply (which contains the tool calls request) to the messages
            messages.append(response_message)
            
            # 3. Process each tool call
            for tool_call in tool_calls:
                function_name = tool_call.function.name
                function_to_call = available_functions.get(function_name)
                
                if function_to_call:
                    function_args = json.loads(tool_call.function.arguments)
                    # Call the actual Python function
                    function_response = function_to_call(
                        location=function_args.get("location"),
                        unit=function_args.get("unit", "celsius")
                    )
                    print(f"[Tool Response] {function_response}")
                    
                    # Append the tool's result to the conversation
                    messages.append(
                        {
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "name": function_name,
                            "content": function_response,
                        }
                    )
            
            # 4. Send the tool execution results back to the model for the final response
            print("\nSending tool results back to model for final synthesis...")
            second_response = client.chat.completions.create(
                model=model_name,
                messages=messages,
            )
            final_content = second_response.choices[0].message.content
            print("\nFinal Model Response:")
            print(final_content)
        else:
            print("Model did not call any tools. Response:")
            print(response_message.content)
            
    except Exception as e:
        print(f"\nAn error occurred during agent execution: {str(e)}")

if __name__ == "__main__":
    run_agent_conversation()
