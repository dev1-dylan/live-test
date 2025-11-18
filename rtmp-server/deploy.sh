#!/bin/bash

echo "*/------ Start deploy ------*/"

PM2_APP_NAME="dev_nms"

# Step 1: Build Server
# yarn install
npm run build

# Step 2: Zip files to send to server
files=("build")
# files+=("node_modules") #Add node_modules if has new package
current_time=$(date "+%Y-%m-%d_%H-%M-%S")
zip_file="archive_${current_time}.zip"
zip -r "$zip_file" "${files[@]}"

# Step 3: Send file to server
# Server information
server_ip="206.189.146.78"
ssh_path="C:/Users/oscar/.ssh/id_rsa"
server_username="dev2"
server_path="brand/xclive/rtmp-server"

scp -i "$ssh_path" "$zip_file" "$server_username@$server_ip:$server_path"

# Step 4: Connect to server and unzip file, restart pm2
ssh -i "$ssh_path" "$server_username@$server_ip" "\
    unzip -o \"$server_path/$zip_file\" -d \"$server_path\" && \
    rm \"$server_path/$zip_file\" && \
    cd \"$server_path\" && \
    pm2 del \"$PM2_APP_NAME\" && \
    nvm use 20 && \
    pm2 start ecosystem.config.js
"

echo "---------------------------->"
echo "Remove zip file"
rm $zip_file

echo "*/------ Deploy successfully ------*/"


