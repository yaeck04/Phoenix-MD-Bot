FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN apt-get update && \
  apt-get install -y ffmpeg imagemagick webp && \
  rm -rf /var/lib/apt/lists/*

CMD ["npm", "start"]
