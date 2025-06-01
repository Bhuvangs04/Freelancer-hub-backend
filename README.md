# 🌐 Freelancer Hub Backend

Welcome to the backend repository for the Freelancer Hub website! This project is built using MongoDB, Express, JWT, Razorpay, and Nodemailer.

## 🚀 Features

- **MongoDB**: Our database solution for storing user data and project information.
- **Express**: A fast, unopinionated, minimalist web framework for Node.js.
- **JWT**: JSON Web Tokens for secure user authentication.
- **Razorpay**: Payment gateway integration for handling transactions.
- **Nodemailer**: Sending emails for notifications and verifications.

## 📂 Project Structure

```
/backend
├── controllers
├── models
├── routes
├── utils
├── config
└── app.js
```

## 🛠️ Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/Bhuvangs04/Freelancer-hub-backend.git
    ```
2. Navigate to the project directory:
    ```sh
    cd freelancer-hub-backend
    ```
3. Install dependencies:
    ```sh
    npm install
    ```

## ⚙️ Configuration

Create a `.env` file in the root directory and add the following environment variables:

```
AWS_ACCESS_KEY_ID = your_aws_access_key
AWS_BUCKET_NAME = your_s3_bucket-name
AWS_REGION = your_aws_region
AWS_SECRET_ACCESS_KEY  = your_aws_secret_key
MONGO_URI=your_mongodb_uri
JWT_SECRET=your_jwt_secret
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
EMAIL_USER=your_email
EMAIL_PASS=your_email_password
```

## 🚀 Usage

Start the development server:
```sh
npm run dev
```

## 📬 Contact

For any inquiries, please reach out to us at [freelancer.hub.nextgen@gmail.com](mailto:freelancer.hub.nextgen@gmail.com).

## 📜 License

This project is licensed under the MIT License.

---

Made with ❤️ by the Bhuvan G S
