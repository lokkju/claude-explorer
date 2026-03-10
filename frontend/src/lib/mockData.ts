import type { ConversationSummary, ConversationDetail, Message } from './types'

export const mockConversations: ConversationSummary[] = [
  {
    uuid: '1',
    name: 'Help me build a REST API',
    summary: 'Building a FastAPI backend with authentication',
    model: 'claude-sonnet-4',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-02T15:30:00Z',
    is_starred: true,
    is_temporary: false,
    message_count: 24,
    human_message_count: 12,
    has_branches: false,
    source: 'CLAUDE_AI',
  },
  {
    uuid: '2',
    name: 'React TypeScript best practices',
    summary: 'Discussion about React patterns and TypeScript',
    model: 'claude-opus-4',
    created_at: '2026-02-28T09:00:00Z',
    updated_at: '2026-03-02T14:00:00Z',
    is_starred: true,
    is_temporary: false,
    message_count: 42,
    human_message_count: 20,
    has_branches: true,
    source: 'CLAUDE_AI',
  },
  {
    uuid: '3',
    name: 'Debug this Python script',
    summary: 'Fixing a bug in data processing script',
    model: 'claude-sonnet-4',
    created_at: '2026-03-02T08:00:00Z',
    updated_at: '2026-03-02T12:00:00Z',
    is_starred: false,
    is_temporary: false,
    message_count: 8,
    human_message_count: 4,
    has_branches: false,
    source: 'CLAUDE_AI',
  },
  {
    uuid: '4',
    name: 'Explain machine learning concepts',
    summary: 'Introduction to neural networks and deep learning',
    model: 'claude-opus-4',
    created_at: '2026-02-25T14:00:00Z',
    updated_at: '2026-02-25T16:00:00Z',
    is_starred: false,
    is_temporary: false,
    message_count: 16,
    human_message_count: 8,
    has_branches: false,
    source: 'CLAUDE_AI',
  },
  {
    uuid: '5',
    name: 'Code review for my project',
    summary: 'Review of authentication module',
    model: 'claude-sonnet-4',
    created_at: '2026-02-20T10:00:00Z',
    updated_at: '2026-02-20T11:30:00Z',
    is_starred: false,
    is_temporary: false,
    message_count: 6,
    human_message_count: 3,
    has_branches: false,
    source: 'CLAUDE_AI',
  },
]

const mockMessages: Message[] = [
  {
    uuid: 'm1',
    sender: 'human',
    text: 'Can you help me build a REST API with FastAPI?',
    content: [{ type: 'text', text: 'Can you help me build a REST API with FastAPI?' }],
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    truncated: false,
    parent_message_uuid: null,
    attachments: [],
    files: [],
  },
  {
    uuid: 'm2',
    sender: 'assistant',
    text: `I'd be happy to help you build a REST API with FastAPI! FastAPI is an excellent choice for building modern, fast APIs with Python.

Here's a basic example to get you started:

\`\`\`python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float
    is_offer: bool = False

@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.get("/items/{item_id}")
def read_item(item_id: int, q: str = None):
    return {"item_id": item_id, "q": q}

@app.post("/items/")
def create_item(item: Item):
    return item
\`\`\`

Key features of FastAPI:
- **Automatic API documentation** (Swagger UI at \`/docs\`)
- **Type hints** for request/response validation
- **Async support** out of the box
- **Pydantic models** for data validation

Would you like me to explain any specific part in more detail?`,
    content: [],
    created_at: '2026-03-01T10:01:00Z',
    updated_at: '2026-03-01T10:01:00Z',
    truncated: false,
    parent_message_uuid: 'm1',
    attachments: [],
    files: [],
  },
  {
    uuid: 'm3',
    sender: 'human',
    text: 'How do I add authentication to this API?',
    content: [{ type: 'text', text: 'How do I add authentication to this API?' }],
    created_at: '2026-03-01T10:05:00Z',
    updated_at: '2026-03-01T10:05:00Z',
    truncated: false,
    parent_message_uuid: 'm2',
    attachments: [],
    files: [],
  },
  {
    uuid: 'm4',
    sender: 'assistant',
    text: `Great question! There are several ways to add authentication to FastAPI. I'll show you JWT (JSON Web Token) authentication, which is commonly used for REST APIs.

First, install the required dependencies:

\`\`\`bash
pip install python-jose[cryptography] passlib[bcrypt]
\`\`\`

Here's a complete example with JWT authentication:

\`\`\`python
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

# Configuration
SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

app = FastAPI()

class Token(BaseModel):
    access_token: str
    token_type: str

class User(BaseModel):
    username: str
    email: Optional[str] = None

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return User(username=username)

@app.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # Validate user credentials here
    access_token = create_access_token(data={"sub": form_data.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user
\`\`\`

This gives you:
- Password hashing with bcrypt
- JWT token generation and validation
- Protected endpoints using \`Depends(get_current_user)\`

Would you like me to add database integration or explain any part further?`,
    content: [],
    created_at: '2026-03-01T10:06:00Z',
    updated_at: '2026-03-01T10:06:00Z',
    truncated: false,
    parent_message_uuid: 'm3',
    attachments: [],
    files: [],
  },
]

export const mockConversationDetails: Record<string, ConversationDetail> = {
  '1': {
    ...mockConversations[0],
    messages: mockMessages,
    current_leaf_message_uuid: 'm4',
  },
  '2': {
    ...mockConversations[1],
    messages: [
      {
        uuid: 'm5',
        sender: 'human',
        text: 'What are the best practices for React with TypeScript?',
        content: [],
        created_at: '2026-02-28T09:00:00Z',
        updated_at: '2026-02-28T09:00:00Z',
        truncated: false,
        parent_message_uuid: null,
        attachments: [],
        files: [],
      },
      {
        uuid: 'm6',
        sender: 'assistant',
        text: `Here are the key best practices for using React with TypeScript:

## 1. Component Props Typing

\`\`\`typescript
interface ButtonProps {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}

function Button({ label, onClick, variant = 'primary', disabled }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled} className={variant}>
      {label}
    </button>
  )
}
\`\`\`

## 2. Use \`React.FC\` Sparingly

Prefer explicit return types instead of \`React.FC\`:

\`\`\`typescript
// Prefer this
function MyComponent({ children }: { children: React.ReactNode }): JSX.Element {
  return <div>{children}</div>
}
\`\`\`

## 3. Event Handler Typing

\`\`\`typescript
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setValue(e.target.value)
}

const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault()
}
\`\`\`

## 4. Generic Components

\`\`\`typescript
interface ListProps<T> {
  items: T[]
  renderItem: (item: T) => React.ReactNode
}

function List<T>({ items, renderItem }: ListProps<T>) {
  return <ul>{items.map(renderItem)}</ul>
}
\`\`\`

Would you like me to cover more advanced patterns?`,
        content: [],
        created_at: '2026-02-28T09:01:00Z',
        updated_at: '2026-02-28T09:01:00Z',
        truncated: false,
        parent_message_uuid: 'm5',
        attachments: [],
        files: [],
      },
    ],
    current_leaf_message_uuid: 'm6',
  },
}

// Helper to filter conversations by search query
export function filterConversations(
  conversations: ConversationSummary[],
  search?: string
): ConversationSummary[] {
  if (!search) return conversations

  const query = search.toLowerCase()
  return conversations.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.summary.toLowerCase().includes(query)
  )
}