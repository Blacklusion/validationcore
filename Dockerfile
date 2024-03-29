FROM node:12-alpine

WORKDIR /app

# install build dependencies
RUN apk add --no-cache \
    bash \
    git \
    make

# install application dependencies
COPY package.json ./
#RUN JOBS=max yarn install --non-interactive --frozen-lockfile

# copy in application source
COPY . .

# compile sources
#RUN make lib

# prune modules
#RUN yarn install --non-interactive --frozen-lockfile --production
RUN npm install
RUN npm install -g typescript
RUN npm install -g ts-node
# copy built application to runtime image
#FROM node:12-alpine
#WORKDIR /app
#COPY --from=build-stage /app/config config
#COPY --from=build-stage /app/lib lib
#COPY --from=build-stage /app/node_modules node_modules

# setup default env
ENV NODE_ENV production

# install wait script
ADD https://github.com/ufoscout/docker-compose-wait/releases/download/2.2.1/wait /wait
RUN chmod +x /wait

## Launch the wait tool and then your application
CMD /wait && ts-node src/index.ts