#!/bin/bash
docker exec -it e_commerce_01-mongo-1 mongosh --eval "rs.initiate()"