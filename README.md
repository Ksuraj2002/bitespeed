About 

Created a backend service that resolves customer identity by linking contacts sharing the same email or phone number.

## Prerequisites

- **Node.js** ≥ 16
- **PostgreSQL** running locally (or a remote connection string)


**Request body** (JSON):

```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

Either `email` or `phoneNumber` (or both) must be provided.

**Response** (200):

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

## How It Works


| Brand new customer | No matching email or phone | Create a new **primary** contact |
| Existing customer, no new info | Exact match already exists | Return consolidated cluster |
| Existing customer, new info | One field matches, other is new | Create a **secondary** linked to the primary |
| Merging two primaries | Email matches one primary, phone matches another | Demote the newer primary to secondary; re-link its children |
